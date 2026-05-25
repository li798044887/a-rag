from fastapi import APIRouter, Depends

from app.db import SessionLocal
from app.embedding.factory import get_embedder
from app.reranker.factory import get_reranker
from app.retrieval.service import retrieve as run_retrieve_service
from app.schemas import RetrieveRequest, RetrieveResponse, RetrievedChunk
from app.security import require_internal_token
from app.vectorstore.qdrant import QdrantStore

router = APIRouter()


def _run_retrieve(req: RetrieveRequest) -> list[RetrievedChunk]:
    session = SessionLocal()
    try:
        embedder = get_embedder()
        dim = getattr(embedder, "dim", 1024)
        store = QdrantStore(dim=dim)
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
