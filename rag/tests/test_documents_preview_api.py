from app.config import settings
from app.routers import documents as documents_router
from app.schemas import FetchDocumentResponse, FetchedChunk


def test_preview_requires_token(client):
    res = client.get("/documents/d1/preview?owner_user_id=u1")
    assert res.status_code == 401


def test_preview_returns_all_chunks(client, monkeypatch):
    def fake(document_id, owner_user_id):
        return FetchDocumentResponse(
            document_id=document_id, document_title="設計.pdf",
            chunks=[FetchedChunk(chunk_id=f"c{i}", ordinal=i, heading_path="",
                                 page_start=0, page_end=0, block_type="text",
                                 text=f"本文{i}") for i in range(60)])

    monkeypatch.setattr(documents_router, "_preview_document", fake)
    res = client.get("/documents/d1/preview?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    # 引用用の上限(40)を超えて全件返ること
    assert len(res.json()["chunks"]) == 60


def test_preview_404_when_not_owner(client, monkeypatch):
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
    res = client.get("/documents/d1/preview?owner_user_id=intruder-B",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
