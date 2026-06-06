import json

from app.config import settings
from app.main import app
from app.routers import retrieve as retrieve_router
from app.schemas import RetrieveRequest
from app.schemas import RetrievedChunk
from fastapi.testclient import TestClient


def test_retrieve_requires_token():
    client = TestClient(app)
    res = client.post("/retrieve", json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 401


def test_retrieve_returns_chunks(monkeypatch):
    def fake_run(req):
        return [RetrievedChunk(chunk_id="c1", document_id="d1", document_title="t",
                               heading_path="H", page_start=0, page_end=0, block_type="text",
                               text="body", expanded_text="exp", score=0.9)]
    monkeypatch.setattr(retrieve_router, "_run_retrieve", fake_run)
    client = TestClient(app)
    res = client.post("/retrieve", headers={"x-internal-token": settings.rag_internal_token},
                      json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 200
    assert res.json()["chunks"][0]["chunk_id"] == "c1"


def test_retrieve_stream_emits_ndjson(monkeypatch):
    def fake_stream(*args, **kwargs):
        yield {"stage": "embed", "status": "done", "ms": 1}
        yield {"stage": "vector_search", "status": "done", "ms": 2, "count": 3}
        yield {"stage": "result", "chunks": [RetrievedChunk(
            chunk_id="c1", document_id="d1", document_title="t", heading_path="H",
            page_start=0, page_end=0, block_type="text", text="b", expanded_text="e", score=0.9)]}
    monkeypatch.setattr(retrieve_router, "retrieve_stream", fake_stream)
    client = TestClient(app)
    res = client.post("/retrieve/stream", headers={"x-internal-token": settings.rag_internal_token},
                      json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 200
    lines = [json.loads(l) for l in res.text.splitlines() if l.strip()]
    assert len(lines) == 3
    assert lines[0] == {"stage": "embed", "status": "done", "ms": 1}
    assert lines[1] == {"stage": "vector_search", "status": "done", "ms": 2, "count": 3}
    assert lines[-1]["stage"] == "result"
    assert lines[-1]["chunks"][0]["chunk_id"] == "c1"


def test_retrieve_stream_requires_token():
    client = TestClient(app)
    res = client.post("/retrieve/stream", json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 401


def test_retrieve_request_defaults_to_cpu_friendly_candidate_count():
    req = RetrieveRequest(query="x", owner_user_id="u1")
    assert req.candidate_k == 10


def test_retrieve_accepts_document_ids(monkeypatch):
    captured = {}

    def fake_run(req):
        captured["document_ids"] = req.document_ids
        return [RetrievedChunk(chunk_id="c1", document_id="docA", document_title="t",
                               heading_path="H", page_start=0, page_end=0, block_type="text",
                               text="body", expanded_text="exp", score=0.9)]

    monkeypatch.setattr(retrieve_router, "_run_retrieve", fake_run)
    client = TestClient(app)
    res = client.post("/retrieve", headers={"x-internal-token": settings.rag_internal_token},
                      json={"query": "本文", "owner_user_id": "u1",
                            "top_k": 5, "document_ids": ["docA"]})
    assert res.status_code == 200
    assert captured["document_ids"] == ["docA"]


def test_retrieve_request_multi_hop_defaults_false():
    req = RetrieveRequest(query="x", owner_user_id="u1")
    assert req.multi_hop is False
    req2 = RetrieveRequest(query="x", owner_user_id="u1", multi_hop=True)
    assert req2.multi_hop is True


def _patch_resources(monkeypatch):
    class _Dummy:
        dim = 8
        def close(self):
            pass
    monkeypatch.setattr(retrieve_router, "SessionLocal", lambda: _Dummy())
    monkeypatch.setattr(retrieve_router, "get_embedder", lambda: _Dummy())
    monkeypatch.setattr(retrieve_router, "get_reranker", lambda: None)
    monkeypatch.setattr(retrieve_router, "QdrantStore", lambda **k: _Dummy())


def test_run_retrieve_branches_on_multi_hop(monkeypatch):
    _patch_resources(monkeypatch)
    seen = {}
    monkeypatch.setattr(retrieve_router, "run_retrieve_service",
                        lambda *a, **k: seen.update(which="single") or [])
    monkeypatch.setattr(retrieve_router, "retrieve_multihop",
                        lambda *a, **k: seen.update(which="multi") or [])
    retrieve_router._run_retrieve(RetrieveRequest(query="x", owner_user_id="u1"))
    assert seen["which"] == "single"
    retrieve_router._run_retrieve(RetrieveRequest(query="x", owner_user_id="u1", multi_hop=True))
    assert seen["which"] == "multi"
