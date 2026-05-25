from typing import Protocol


class Reranker(Protocol):
    def score(self, query: str, docs: list[str]) -> list[float]: ...
