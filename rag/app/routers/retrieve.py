import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.db import SessionLocal
from app.embedding.factory import get_embedder
from app.reranker.factory import get_reranker
from app.retrieval.service import retrieve as run_retrieve_service
from app.retrieval.service import retrieve_stream
from app.schemas import RetrieveRequest, RetrieveResponse, RetrievedChunk
from app.security import require_internal_token
from app.vectorstore.qdrant import QdrantStore

router = APIRouter()


def _run_retrieve(req: RetrieveRequest) -> list[RetrievedChunk]:
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=getattr(embedder, "dim", 1024))
        return run_retrieve_service(
            session, store, embedder, get_reranker(),
            query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
            top_k=req.top_k, candidate_k=req.candidate_k)
    finally:
        session.close()


@router.post("/retrieve", response_model=RetrieveResponse,
             dependencies=[Depends(require_internal_token)])
def retrieve_endpoint(req: RetrieveRequest):
    return RetrieveResponse(chunks=_run_retrieve(req))


def _stream_ndjson(req: RetrieveRequest):
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=getattr(embedder, "dim", 1024))
        for ev in retrieve_stream(
                session, store, embedder, get_reranker(),
                query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
                top_k=req.top_k, candidate_k=req.candidate_k):
            if ev.get("stage") == "result":
                payload = {"stage": "result", "chunks": [c.model_dump() for c in ev["chunks"]]}
            else:
                payload = ev
            yield json.dumps(payload, ensure_ascii=False) + "\n"
    finally:
        session.close()


@router.post("/retrieve/stream", response_class=StreamingResponse,
             dependencies=[Depends(require_internal_token)])
def retrieve_stream_endpoint(req: RetrieveRequest):
    return StreamingResponse(_stream_ndjson(req), media_type="application/x-ndjson")
