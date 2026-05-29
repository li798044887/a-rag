import hashlib
import os
import threading

from app.embedding.base import DenseSparse, Embedder

_cache: dict[str, Embedder] = {}
_lock = threading.Lock()


class StubEmbedder:
    """テスト/オフライン用の決定的スタブ。"""
    def __init__(self, dim: int = 8):
        self.dim = dim
        self.name = "stub"

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
    if kind in _cache:
        return _cache[kind]
    # 並列初回リクエストが同じ重いモデルを二重ロードしないよう double-checked locking で直列化。
    with _lock:
        if kind in _cache:
            return _cache[kind]
        if kind == "stub":
            inst: Embedder = StubEmbedder()
        elif kind == "bge-m3":
            from app.embedding.bge_m3 import BGEM3Embedder
            inst = BGEM3Embedder()
        else:
            raise ValueError(f"unknown EMBEDDER: {kind}")
        _cache[kind] = inst
        return inst
