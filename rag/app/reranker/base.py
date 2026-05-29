from typing import Protocol


class Reranker(Protocol):
    name: str

    def score(self, query: str, docs: list[str]) -> list[float]: ...
