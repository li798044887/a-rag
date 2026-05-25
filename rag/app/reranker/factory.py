import os

from app.reranker.base import Reranker


class StubReranker:
    """文字 n-gram 重なりで擬似スコア（テスト/オフライン用）。"""
    def score(self, query: str, docs: list[str]) -> list[float]:
        qset = set(query.replace(" ", ""))
        return [len(qset & set(d)) / (len(qset) or 1) for d in docs]


def get_reranker() -> Reranker:
    kind = os.getenv("RERANKER", "bge")
    if kind == "stub":
        return StubReranker()
    if kind == "bge":
        from app.reranker.bge import BGEReranker
        return BGEReranker()
    raise ValueError(f"unknown RERANKER: {kind}")
