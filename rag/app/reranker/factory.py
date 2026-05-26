import os

from app.reranker.base import Reranker

_cache: dict[str, Reranker] = {}


class StubReranker:
    """文字 n-gram 重なりで擬似スコア（テスト/オフライン用）。"""
    def score(self, query: str, docs: list[str]) -> list[float]:
        qset = set(query.replace(" ", ""))
        return [len(qset & set(d)) / (len(qset) or 1) for d in docs]


def get_reranker() -> Reranker:
    kind = os.getenv("RERANKER", "bge")
    if kind in _cache:
        return _cache[kind]
    if kind == "stub":
        inst: Reranker = StubReranker()
    elif kind == "bge":
        from app.reranker.bge import BGEReranker
        inst = BGEReranker()
    else:
        raise ValueError(f"unknown RERANKER: {kind}")
    _cache[kind] = inst
    return inst
