from app.config import settings
from app.documents_service import select_chunks
from app.routers import documents as documents_router
from app.schemas import FetchDocumentResponse, FetchedChunk


class _C:
    def __init__(self, ordinal):
        self.ordinal = ordinal
        self.id = f"c{ordinal}"


def test_select_chunks_truncates_to_max():
    chunks = [_C(i) for i in range(100)]
    out = select_chunks(chunks, around_ordinal=None, window=2, max_chunks=40)
    assert len(out) == 40
    assert out[0].ordinal == 0


def test_select_chunks_windows_around_ordinal():
    chunks = [_C(i) for i in range(100)]
    out = select_chunks(chunks, around_ordinal=50, window=2, max_chunks=40)
    assert [c.ordinal for c in out] == [48, 49, 50, 51, 52]


def test_fetch_document_requires_token(client):
    res = client.post("/documents/d1/chunks", json={"owner_user_id": "u1"})
    assert res.status_code == 401


def test_fetch_document_returns_chunks(client, monkeypatch):
    def fake(document_id, req):
        return FetchDocumentResponse(
            document_id=document_id, document_title="設計.pdf",
            chunks=[FetchedChunk(chunk_id="c1", ordinal=0, heading_path="認証",
                                 page_start=0, page_end=0, block_type="text", text="本文")])
    monkeypatch.setattr(documents_router, "_fetch_document", fake)
    res = client.post("/documents/d1/chunks",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "u1"})
    assert res.status_code == 200
    body = res.json()
    assert body["document_title"] == "設計.pdf"
    assert body["chunks"][0]["chunk_id"] == "c1"


def test_fetch_document_404_when_not_owner(client, monkeypatch):
    class _Doc:
        owner_user_id = "owner-A"
    class _Session:
        def get(self, model, _id):
            return _Doc()
        def query(self, *a, **k):
            raise AssertionError("should not query when ownership fails")
        def close(self):
            pass
    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.post("/documents/d1/chunks",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "intruder-B"})
    assert res.status_code == 404
