import hashlib
import os

from app.embedding.base import DenseSparse, Embedder


class StubEmbedder:
    """テスト/オフライン用の決定的スタブ。"""
    def __init__(self, dim: int = 8):
        self.dim = dim

    def embed(self, texts: list[str]) -> list[DenseSparse]:
        out = []
        for t in texts:
            h = hashlib.sha256(t.encode()).digest()
            dense = [((h[i % len(h)]) / 255.0) for i in range(self.dim)]
            sparse = {b: 1.0 for b in set(h[:4])}
            out.append(DenseSparse(dense=dense, sparse=sparse))
        return out


def get_embedder() -> Embedder:
    kind = os.getenv("EMBEDDER", "bge-m3")
    if kind == "stub":
        return StubEmbedder()
    if kind == "bge-m3":
        from app.embedding.bge_m3 import BGEM3Embedder
        return BGEM3Embedder()
    raise ValueError(f"unknown EMBEDDER: {kind}")
