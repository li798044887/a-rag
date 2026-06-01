from app.config import settings
from app.routers import documents as documents_router


def test_cancel_requires_token(client):
    res = client.post("/jobs/j1/cancel?owner_user_id=u1")
    assert res.status_code == 401


def _install_fakes(monkeypatch, *, owner="u1", status="queued", job_exists=True):
    state = {"deleted_jobs": 0, "doc_deleted": False, "files": None}

    class _Job:
        id = "j1"
        document_id = "d1"
        owner_user_id = owner
        status = "queued"

    class _Doc:
        id = "d1"
        owner_user_id = owner
        raw_path = "/u/d1.pdf"

    job = _Job()
    job.status = status

    class _DeleteQuery:
        def filter(self, *a, **k):
            return self

        def delete(self):
            # status が queued のときだけ削除成功（原子ガードの模倣）
            if job.status == "queued":
                state["deleted_jobs"] = 1
                return 1
            return 0

    class _Session:
        def get(self, model, _id):
            if model is documents_router.IngestJob:
                return job if job_exists else None
            return _Doc()

        def query(self, model):
            return _DeleteQuery()

        def delete(self, obj):
            state["doc_deleted"] = True

        def rollback(self):
            pass

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "cleanup_document_files",
                        lambda raw, md=None: state.update(files=(raw, md)))
    return state


def test_cancel_queued_deletes_job_doc_and_files(client, monkeypatch):
    state = _install_fakes(monkeypatch, status="queued")
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 204
    assert state["deleted_jobs"] == 1
    assert state["doc_deleted"] is True
    assert state["files"] == ("/u/d1.pdf", None)


def test_cancel_409_when_not_queued(client, monkeypatch):
    _install_fakes(monkeypatch, status="parsing")
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 409


def test_cancel_404_when_not_owner(client, monkeypatch):
    _install_fakes(monkeypatch, owner="owner-A")
    res = client.post("/jobs/j1/cancel?owner_user_id=intruder-B",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


def test_cancel_404_when_job_missing(client, monkeypatch):
    _install_fakes(monkeypatch, job_exists=False)
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
