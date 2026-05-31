from datetime import datetime

from app.config import settings
from app.routers import documents as documents_router
from app.schemas import DocumentListItem, DocumentListResponse, WorkspaceStats


def test_list_requires_token(client):
    res = client.get("/documents?owner_user_id=u1")
    assert res.status_code == 401


def test_list_passes_filters_and_returns_payload(client, monkeypatch):
    seen = {}

    def fake_list(owner_user_id, limit, cursor, q, status):
        seen.update(owner_user_id=owner_user_id, limit=limit, cursor=cursor, q=q, status=status)
        return DocumentListResponse(
            items=[DocumentListItem(
                id="d1", filename="a.pdf", mime="application/pdf", size=10,
                page_count=2, status="ready", created_at=datetime(2026, 5, 31),
                chunk_count=4, latest_job_id="j1", error=None)],
            next_cursor="CUR", total=1)

    monkeypatch.setattr(documents_router, "_list_documents", fake_list)
    res = client.get(
        "/documents?owner_user_id=u1&limit=10&q=設計&status=ready",
        headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["next_cursor"] == "CUR"
    assert body["items"][0]["chunk_count"] == 4
    assert seen == {"owner_user_id": "u1", "limit": 10, "cursor": None, "q": "設計", "status": "ready"}


def test_list_invalid_cursor_returns_400(client, monkeypatch):
    def boom(*a, **k):
        raise ValueError("invalid cursor")

    monkeypatch.setattr(documents_router, "_list_documents", boom)
    res = client.get("/documents?owner_user_id=u1&cursor=@@bad@@",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 400


def test_workspace_stats_passes_owner_and_returns_payload(client, monkeypatch):
    seen = {}

    def fake_stats(owner_user_id):
        seen["owner_user_id"] = owner_user_id
        return WorkspaceStats(
            indexed_document_count=2,
            total_document_count=3,
            connected_data_source_count=1,
            last_synced_at=datetime(2026, 5, 31, 8, 14),
        )

    monkeypatch.setattr(documents_router, "_workspace_stats", fake_stats)
    res = client.get(
        "/documents/stats?owner_user_id=u1",
        headers={"x-internal-token": settings.rag_internal_token},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["indexed_document_count"] == 2
    assert body["total_document_count"] == 3
    assert body["connected_data_source_count"] == 1
    assert body["last_synced_at"].startswith("2026-05-31T08:14")
    assert seen == {"owner_user_id": "u1"}


def test_workspace_stats_serializes_last_synced_at_as_utc(client, monkeypatch):
    def fake_stats(owner_user_id):
        return WorkspaceStats(
            indexed_document_count=2,
            total_document_count=3,
            connected_data_source_count=1,
            last_synced_at=datetime(2026, 5, 31, 8, 14),
        )

    monkeypatch.setattr(documents_router, "_workspace_stats", fake_stats)
    res = client.get(
        "/documents/stats?owner_user_id=u1",
        headers={"x-internal-token": settings.rag_internal_token},
    )

    assert res.status_code == 200
    assert res.json()["last_synced_at"] == "2026-05-31T08:14:00Z"
