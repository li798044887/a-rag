from app.embedding.base import DenseSparse
from app.embedding.factory import StubEmbedder, get_embedder


def test_stub_embedder_is_deterministic():
    e = StubEmbedder(dim=8)
    a = e.embed(["hello"])[0]
    b = e.embed(["hello"])[0]
    assert isinstance(a, DenseSparse)
    assert len(a.dense) == 8
    assert a.dense == b.dense


def test_factory_returns_stub_when_embedder_is_stub(monkeypatch):
    monkeypatch.setenv("EMBEDDER", "stub")
    e = get_embedder()
    assert isinstance(e, StubEmbedder)
