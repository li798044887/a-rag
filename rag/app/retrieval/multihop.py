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
