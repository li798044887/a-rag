from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.models import Chunk, Document
from app.reranker.base import Reranker
from app.schemas import RetrievedChunk
from app.vectorstore.qdrant import QdrantStore


def _expand(session: Session, document_id: str, ordinal: int) -> str:
    rows = (session.query(Chunk)
            .filter(Chunk.document_id == document_id,
                    Chunk.ordinal.in_([ordinal - 1, ordinal, ordinal + 1]))
            .order_by(Chunk.ordinal).all())
    return "\n\n".join(r.text for r in rows) if rows else ""


def retrieve(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
             *, query: str, owner_user_id: str, top_k: int = 6,
             candidate_k: int = 40) -> list[RetrievedChunk]:
    qv = embedder.embed([query])[0]
    hits = store.hybrid_search(qv, owner_user_id=owner_user_id, limit=candidate_k)
    if not hits:
        return []

    rr = reranker.score(query, [h["text"] for h in hits])
    ranked = sorted(zip(hits, rr), key=lambda x: x[1], reverse=True)[:top_k]

    title_cache: dict[str, str] = {}
    out: list[RetrievedChunk] = []
    for hit, score in ranked:
        doc_id = hit["document_id"]
        if doc_id not in title_cache:
            doc = session.get(Document, doc_id)
            title_cache[doc_id] = doc.filename if doc else doc_id
        chunk = session.get(Chunk, hit["chunk_id"])
        ordinal = chunk.ordinal if chunk else 0
        out.append(RetrievedChunk(
            chunk_id=hit["chunk_id"], document_id=doc_id,
            document_title=title_cache[doc_id], heading_path=hit.get("heading_path", ""),
            page_start=hit.get("page_start", 0), page_end=hit.get("page_end", 0),
            block_type=hit.get("block_type", "text"), text=hit["text"],
            expanded_text=_expand(session, doc_id, ordinal), score=float(score),
        ))
    return out
