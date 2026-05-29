import io

from app.config import settings
from app.routers import documents as documents_router


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


def test_raw_requires_token(client):
    res = client.get("/documents/d1/raw")
    assert res.status_code == 401


def test_raw_streams_file(client, monkeypatch, tmp_path):
    pdf = tmp_path / "src.pdf"
    pdf.write_bytes(b"%PDF-1.7\n...")

    class _Doc:
        owner_user_id = "u1"
        mime = "application/pdf"
        raw_path = str(pdf)
        filename = "src.pdf"

    class _Session:
        def get(self, model, _id):
            return _Doc()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.get("/documents/d1/raw?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/pdf")
    assert res.content.startswith(b"%PDF")


def test_raw_404_when_not_owner(client, monkeypatch):
    class _Doc:
        owner_user_id = "owner-A"
        mime = "application/pdf"
        raw_path = "/nope.pdf"
        filename = "x.pdf"

    class _Session:
        def get(self, model, _id):
            return _Doc()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.get("/documents/d1/raw?owner_user_id=intruder-B",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
