import io

from app.config import settings


def test_upload_requires_internal_token(client):
    res = client.post("/documents", files={"file": ("a.pdf", b"x", "application/pdf")},
                      data={"owner_user_id": "u1"})
    assert res.status_code == 401


def test_upload_creates_doc_and_enqueues(client, monkeypatch):
    enqueued = {}

    async def fake_enqueue(document_id, job_id):
        enqueued["args"] = (document_id, job_id)

    monkeypatch.setattr("app.routers.documents.enqueue_ingest", fake_enqueue)
    res = client.post(
        "/documents",
        headers={"x-internal-token": settings.rag_internal_token},
        files={"file": ("a.pdf", io.BytesIO(b"hello"), "application/pdf")},
        data={"owner_user_id": "u1"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["document_id"] and body["job_id"]
    assert enqueued["args"][0] == body["document_id"]

    status = client.get(f"/jobs/{body['job_id']}",
                        headers={"x-internal-token": settings.rag_internal_token})
    assert status.status_code == 200
    assert status.json()["status"] in ("queued", "parsing")
