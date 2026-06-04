import io
import os
import uuid

from app.config import settings
from app.routers import documents as documents_router


def test_upload_requires_internal_token(client):
    res = client.post("/documents", files={"file": ("a.pdf", b"x", "application/pdf")},
                      data={"owner_user_id": "u1"})
    assert res.status_code == 401


def test_upload_creates_doc_and_enqueues(client, monkeypatch):
    enqueued = {}
    activity = []

    async def fake_enqueue(document_id, job_id):
        enqueued["args"] = (document_id, job_id)

    monkeypatch.setattr("app.routers.documents.enqueue_ingest", fake_enqueue)
    monkeypatch.setattr(
        documents_router,
        "record_workspace_activity",
        lambda session, *, owner_user_id: activity.append(owner_user_id),
    )
    res = client.post(
        "/documents",
        headers={"x-internal-token": settings.rag_internal_token},
        files={"file": ("a.pdf", io.BytesIO(uuid.uuid4().bytes), "application/pdf")},
        data={"owner_user_id": f"u1-{uuid.uuid4().hex}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["document_id"] and body["job_id"]
    # enqueue は content_hash を第1引数に取る（document_id ではない）
    assert isinstance(enqueued["args"][0], str) and enqueued["args"][1] == body["job_id"]
    assert activity == []

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


def test_raw_head_ok_when_exists(client, monkeypatch, tmp_path):
    # フロントの存在確認は HEAD。原本があれば 200（本文なし）を返すこと。
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
    res = client.head("/documents/d1/raw?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    assert res.content == b""


def test_raw_head_404_when_not_owner(client, monkeypatch):
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
    res = client.head("/documents/d1/raw?owner_user_id=intruder-B",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


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


def _upload(client, owner, content, monkeypatch):
    calls = []

    async def fake_enqueue(content_hash, job_id):
        calls.append((content_hash, job_id))

    monkeypatch.setattr("app.routers.documents.enqueue_ingest", fake_enqueue)
    res = client.post(
        "/documents",
        headers={"x-internal-token": settings.rag_internal_token},
        files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")},
        data={"owner_user_id": owner},
    )
    res._enqueue_calls = calls  # type: ignore[attr-defined]
    return res


def test_duplicate_same_owner_rejected(client, monkeypatch):
    owner = f"dup-{uuid.uuid4().hex}"
    content = uuid.uuid4().bytes
    first = _upload(client, owner, content, monkeypatch)
    assert first.status_code == 200
    second = _upload(client, owner, content, monkeypatch)
    assert second.status_code == 409


def test_duplicate_different_owner_shares_content(client, monkeypatch):
    """別ユーザーの同一バイトは 200 だが、解析は 1 回だけ enqueue され、
    2 人目は参照のみ（ref_count=2、content・chunks は共有）になる。"""
    from app.db import SessionLocal
    from app.models import Content, Document

    content = uuid.uuid4().bytes
    a = _upload(client, f"a-{uuid.uuid4().hex}", content, monkeypatch)
    b = _upload(client, f"b-{uuid.uuid4().hex}", content, monkeypatch)
    assert a.status_code == 200 and b.status_code == 200
    # 同じ job_id（共有ジョブ）を指す
    assert a.json()["job_id"] == b.json()["job_id"]
    # 1 人目だけが解析を enqueue している
    assert len(a._enqueue_calls) == 1
    assert len(b._enqueue_calls) == 0

    import hashlib
    h = hashlib.sha256(content).hexdigest()
    session = SessionLocal()
    try:
        c = session.get(Content, h)
        assert c is not None and c.ref_count == 2
        assert session.query(Document).filter_by(content_hash=h).count() == 2
    finally:
        session.close()


def test_duplicate_does_not_leave_orphan_file(client, monkeypatch):
    owner = f"dup-{uuid.uuid4().hex}"
    content = uuid.uuid4().bytes
    _upload(client, owner, content, monkeypatch)
    before = set(os.listdir(settings.upload_dir))
    second = _upload(client, owner, content, monkeypatch)
    assert second.status_code == 409
    after = set(os.listdir(settings.upload_dir))
    assert after == before  # 409 時に新しい生ファイルを残さない


def test_shared_content_stored_once_on_disk(client, monkeypatch):
    """別ユーザー 2 人が同一バイトを上げても、原本はディスク上に 1 個だけ。"""
    content = uuid.uuid4().bytes
    _upload(client, f"a-{uuid.uuid4().hex}", content, monkeypatch)
    after_first = set(os.listdir(settings.upload_dir))
    _upload(client, f"b-{uuid.uuid4().hex}", content, monkeypatch)
    after_second = set(os.listdir(settings.upload_dir))
    assert after_first == after_second  # 2 人目で新規ファイルは増えない
