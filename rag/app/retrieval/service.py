from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.models import Chunk, Document
from app.reranker.base import Reranker
from app.schemas import RetrievedChunk
from app.vectorstore.qdrant import QdrantStore


def _expand(session: Session, document_id: str, ordinal: int) -> str:
    # 返り値には hit チャンク自身（ordinal）も前後（ordinal±1）と共に含まれる。
    # Phase 5 でプロンプト組立時に text と expanded_text を併用する場合は重複に留意すること。
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
        if chunk is None:
            # Postgres/Qdrant 不整合: チャンクが DB に存在しない。
            # 先頭チャンク（ordinal=0）の近傍を誤って返さないよう近傍拡張を空にする。
            out.append(RetrievedChunk(
                chunk_id=hit["chunk_id"], document_id=doc_id,
                document_title=title_cache[doc_id], heading_path=hit.get("heading_path", ""),
                page_start=hit.get("page_start", 0), page_end=hit.get("page_end", 0),
                block_type=hit.get("block_type", "text"), text=hit["text"],
                expanded_text="", score=float(score),
            ))
            continue
        out.append(RetrievedChunk(
            chunk_id=hit["chunk_id"], document_id=doc_id,
            document_title=title_cache[doc_id], heading_path=hit.get("heading_path", ""),
            page_start=hit.get("page_start", 0), page_end=hit.get("page_end", 0),
            block_type=hit.get("block_type", "text"), text=hit["text"],
            expanded_text=_expand(session, doc_id, chunk.ordinal), score=float(score),
        ))
    return out
