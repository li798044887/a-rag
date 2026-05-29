from dataclasses import dataclass
from typing import Protocol


@dataclass
class DenseSparse:
    dense: list[float]
    sparse: dict[int, float]  # token id -> weight


class Embedder(Protocol):
    dim: int
    name: str

    def embed(self, texts: list[str]) -> list[DenseSparse]: ...
