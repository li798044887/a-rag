"""決定論的テキスト PRF 多ホップ検索。

既存 retrieve/retrieve_stream をブラックボックスとして2回呼び、hop-1 上位チャンク
本文を元クエリへ連結（PRF）して hop-2 を検索、RRF で融合する。LLM 不使用。"""
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.reranker.base import Reranker
from app.retrieval.service import DEFAULT_CANDIDATE_K, retrieve, retrieve_stream
from app.schemas import RetrievedChunk
from app.vectorstore.qdrant import QdrantStore

RRF_K = 60


def _prf_query(query: str, hop1: list[RetrievedChunk], *,
               n_docs: int = 2, char_budget: int = 200) -> str:
    """元クエリの末尾に hop1 上位 n_docs チャンクの title+heading+本文先頭を連結。
    橋渡しエンティティ（hop1 本文中の固有名）をクエリへ注入する。hop1 が空 or
    連結対象が無ければ元クエリをそのまま返す（呼び出し側で hop-2 をスキップ）。"""
    parts = [query]
    for c in hop1[:n_docs]:
        body = (c.expanded_text or c.text or "")[:char_budget]
        seg = " ".join(x for x in (c.document_title, c.heading_path, body) if x).strip()
        if seg:
            parts.append(seg)
    return " ".join(parts).strip()


def _rrf_fuse(hop1: list[RetrievedChunk], hop2: list[RetrievedChunk], *,
              top_k: int, bridge_quota: int = 2) -> list[RetrievedChunk]:
    """既に各クエリでリランク済みの2リストを RRF で融合。chunk_id 重複除去。
    hop2 上位を bridge_quota 枠で予約し、橋渡しの答えがリランクで落ちるのを防ぐ。"""
    if not hop2:
        return hop1[:top_k]
    score: dict[str, float] = {}
    by_id: dict[str, RetrievedChunk] = {}

    def add(lst: list[RetrievedChunk]) -> None:
        for rank, c in enumerate(lst):
            score[c.chunk_id] = score.get(c.chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            by_id.setdefault(c.chunk_id, c)

    add(hop1)
    add(hop2)
    fused = sorted(by_id, key=lambda cid: score[cid], reverse=True)
    top = fused[:top_k]
    top_set = set(top)

    reserved: list[str] = []
    for c in hop2:
        if len(reserved) >= bridge_quota:
            break
        if c.chunk_id not in top_set:
            reserved.append(c.chunk_id)
    if not reserved:
        return [by_id[cid] for cid in top]

    kept = top[:max(0, top_k - len(reserved))]
    kept_set = set(kept)
    final_ids = kept + [cid for cid in reserved if cid not in kept_set]
    return [by_id[cid] for cid in final_ids[:top_k]]


def retrieve_multihop(session: Session, store: QdrantStore, embedder: Embedder,
                      reranker: Reranker, *, query: str, owner_user_id: str,
                      top_k: int = 6, candidate_k: int = DEFAULT_CANDIDATE_K,
                      document_ids: list[str] | None = None,
                      max_hops: int = 1) -> list[RetrievedChunk]:
    """決定論的テキスト PRF 多ホップ。multi_hop 有効時は hop-1 が非空である限り
    無条件で hop-2 を実行（設計判断: 橋渡しは hop-1 高品質ゆえ条件分岐で取りこぼす）。"""
    hop1 = retrieve(session, store, embedder, reranker, query=query,
                    owner_user_id=owner_user_id, top_k=top_k, candidate_k=candidate_k,
                    document_ids=document_ids)
    if not hop1 or max_hops <= 0:
        return hop1
    result = hop1
    current = hop1
    for _ in range(max_hops):
        prf = _prf_query(query, current)
        if prf == query:
            break
        try:
            hopn = retrieve(session, store, embedder, reranker, query=prf,
                            owner_user_id=owner_user_id, top_k=top_k, candidate_k=candidate_k,
                            document_ids=document_ids)
        except Exception:
            break
        if not hopn:
            break
        result = _rrf_fuse(result, hopn, top_k=top_k)
        current = hopn
    return result
