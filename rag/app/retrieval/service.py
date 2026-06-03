import logging
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.models import Chunk, Document
from app.reranker.base import Reranker
from app.schemas import RetrievedChunk
from app.vectorstore.qdrant import QdrantStore

logger = logging.getLogger(__name__)
server_logger = logging.getLogger("uvicorn.error")
DEFAULT_CANDIDATE_K = 10


def _log_info(message: str, *args) -> None:
    logger.info(message, *args)
    server_logger.info("[retrieval] " + message, *args)


def _expand(session: Session, document_id: str, ordinal: int) -> str:
    rows = (session.query(Chunk)
            .filter(Chunk.document_id == document_id,
                    Chunk.ordinal.in_([ordinal - 1, ordinal, ordinal + 1]))
            .order_by(Chunk.ordinal).all())
    return "\n\n".join(r.text for r in rows) if rows else ""


def _merge_round_robin(dense: list[dict], sparse: list[dict], limit: int) -> list[dict]:
    # dense/sparse の各ランクを交互に取り chunk_id で重複除去、limit 件で打ち切る。
    seen: set[str] = set()
    out: list[dict] = []
    for i in range(max(len(dense), len(sparse))):
        for src in (dense, sparse):
            if i < len(src):
                cid = src[i]["chunk_id"]
                if cid not in seen:
                    seen.add(cid)
                    out.append(src[i])
                    if len(out) >= limit:
                        return out
    return out


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def _timed(fn, *args) -> tuple:
    s = time.perf_counter()
    return fn(*args), int((time.perf_counter() - s) * 1000)


def _hit_rows(session: Session, hits: list[dict], title_cache: dict[str, str]) -> list[dict]:
    rows = []
    for h in hits:
        doc_id = h["document_id"]
        if doc_id not in title_cache:
            doc = session.get(Document, doc_id)
            title_cache[doc_id] = doc.filename if doc else doc_id
        rows.append({"title": title_cache[doc_id],
                     "heading": h.get("heading_path", ""),
                     "score": float(h.get("score", 0.0))})
    return rows


def _expanded_rows(chunks: list[RetrievedChunk]) -> list[dict]:
    rows = []
    for c in chunks:
        rows.append({
            "id": c.chunk_id,
            "title": c.document_title,
            "heading": c.heading_path,
            "score": float(c.score),
            "page": c.page_start,
            "blockType": c.block_type,
            "expandedChars": len(c.expanded_text or ""),
            "preview": (c.expanded_text or c.text or "")[:240],
        })
    return rows


def retrieve_stream(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
                    *, query: str, owner_user_id: str, top_k: int = 6,
                    candidate_k: int = DEFAULT_CANDIDATE_K,
                    document_ids: list[str] | None = None) -> Iterator[dict]:
    title_cache: dict[str, str] = {}
    reranker_name = getattr(reranker, "name", "?")
    _log_info("retrieve_stream start top_k=%s candidate_k=%s embedder=%s reranker=%s",
              top_k, candidate_k, getattr(embedder, "name", "?"), reranker_name)

    # 1) embed（1回の呼び出しで dense+sparse の両方を得る）
    _log_info("retrieve_stream stage=embed status=start")
    yield {"stage": "embed", "status": "start"}
    t = time.perf_counter()
    qv = embedder.embed([query])[0]
    embed_ms = _ms(t)
    _log_info("retrieve_stream stage=embed status=done ms=%s dims=%s", embed_ms, len(qv.dense))
    yield {"stage": "embed", "status": "done", "ms": embed_ms,
           "model": getattr(embedder, "name", "?"), "dims": len(qv.dense)}

    # 2) dense / sparse 検索を並行実行（性能大前提）。両 start を先に出す。
    _log_info("retrieve_stream stage=vector_search status=start limit=%s", candidate_k)
    yield {"stage": "vector_search", "status": "start"}
    _log_info("retrieve_stream stage=bm25_search status=start limit=%s", candidate_k)
    yield {"stage": "bm25_search", "status": "start"}
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_dense = ex.submit(_timed, store.dense_search, qv.dense, owner_user_id, candidate_k, document_ids)
        f_sparse = ex.submit(_timed, store.sparse_search, qv.sparse, owner_user_id, candidate_k, document_ids)
        dense_hits, dense_ms = f_dense.result()
        _log_info("retrieve_stream stage=vector_search status=done ms=%s count=%s",
                  dense_ms, len(dense_hits))
        yield {"stage": "vector_search", "status": "done", "ms": dense_ms,
               "count": len(dense_hits), "hits": _hit_rows(session, dense_hits, title_cache)}
        sparse_hits, sparse_ms = f_sparse.result()
        _log_info("retrieve_stream stage=bm25_search status=done ms=%s count=%s",
                  sparse_ms, len(sparse_hits))
        yield {"stage": "bm25_search", "status": "done", "ms": sparse_ms,
               "count": len(sparse_hits), "hits": _hit_rows(session, sparse_hits, title_cache)}

    if not dense_hits and not sparse_hits:
        _log_info("retrieve_stream stage=rerank status=start candidate_count=0 model=%s",
                  reranker_name)
        yield {"stage": "rerank", "status": "start"}
        _log_info("retrieve_stream stage=rerank status=done ms=0 count=0")
        yield {"stage": "rerank", "status": "done", "ms": 0, "count": 0,
               "model": reranker_name, "top_n": top_k, "selected": []}
        _log_info("retrieve_stream stage=expand status=start")
        yield {"stage": "expand", "status": "start"}
        _log_info("retrieve_stream stage=expand status=done ms=0 count=0")
        yield {"stage": "expand", "status": "done", "ms": 0, "count": 0}
        _log_info("retrieve_stream stage=result count=0")
        yield {"stage": "result", "chunks": []}
        return

    # 3) round-robin マージ + candidate_k 打ち切り
    merged = _merge_round_robin(dense_hits, sparse_hits, candidate_k)

    # 4) rerank
    _log_info("retrieve_stream stage=rerank status=start candidate_count=%s model=%s top_k=%s",
              len(merged), reranker_name, top_k)
    yield {"stage": "rerank", "status": "start"}
    tr = time.perf_counter()
    scores = reranker.score(query, [h["text"] for h in merged])
    ranked = sorted(zip(merged, scores), key=lambda x: x[1], reverse=True)[:top_k]
    selected = [{"id": h["chunk_id"], "score": float(s),
                 "title": title_cache.get(h["document_id"], h["document_id"])}
                for h, s in ranked]
    rerank_ms = _ms(tr)
    _log_info("retrieve_stream stage=rerank status=done ms=%s count=%s", rerank_ms, len(ranked))
    yield {"stage": "rerank", "status": "done", "ms": rerank_ms, "count": len(ranked),
           "model": reranker_name, "top_n": top_k, "selected": selected}

    # 5) expand + RetrievedChunk 構築
    _log_info("retrieve_stream stage=expand status=start")
    yield {"stage": "expand", "status": "start"}
    te = time.perf_counter()
    out: list[RetrievedChunk] = []
    for hit, score in ranked:
        doc_id = hit["document_id"]
        # 候補は _hit_rows で解決済みのため通常はキャッシュヒット。念のための防御的フォールバック。
        if doc_id not in title_cache:
            doc = session.get(Document, doc_id)
            title_cache[doc_id] = doc.filename if doc else doc_id
        chunk = session.get(Chunk, hit["chunk_id"])
        expanded = "" if chunk is None else _expand(session, doc_id, chunk.ordinal)
        out.append(RetrievedChunk(
            chunk_id=hit["chunk_id"], document_id=doc_id,
            document_title=title_cache[doc_id], heading_path=hit.get("heading_path", ""),
            page_start=hit.get("page_start", 0), page_end=hit.get("page_end", 0),
            block_type=hit.get("block_type", "text"), text=hit["text"],
            expanded_text=expanded, score=float(score)))
    expand_ms = _ms(te)
    _log_info("retrieve_stream stage=expand status=done ms=%s count=%s", expand_ms, len(out))
    yield {"stage": "expand", "status": "done", "ms": expand_ms, "count": len(out),
           "expanded": _expanded_rows(out)}
    _log_info("retrieve_stream stage=result count=%s", len(out))
    yield {"stage": "result", "chunks": out}


def retrieve(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
             *, query: str, owner_user_id: str, top_k: int = 6,
             candidate_k: int = DEFAULT_CANDIDATE_K,
             document_ids: list[str] | None = None) -> list[RetrievedChunk]:
    # 非ストリーミング用 drain ラッパ（既存 /retrieve と既存テストを温存）。
    result: list[RetrievedChunk] = []
    for ev in retrieve_stream(session, store, embedder, reranker, query=query,
                              owner_user_id=owner_user_id, top_k=top_k, candidate_k=candidate_k,
                              document_ids=document_ids):
        if ev.get("stage") == "result":
            result = ev["chunks"]
            break
    return result
