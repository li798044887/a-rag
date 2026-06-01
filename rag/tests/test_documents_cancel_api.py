from app.config import settings
from app.routers import documents as documents_router


def test_cancel_requires_token(client):
    res = client.post("/jobs/j1/cancel?owner_user_id=u1")
    assert res.status_code == 401


def _install_fakes(monkeypatch, *, owner="u1", status="queued", job_exists=True,
                   simulate_race=False):
    state = {"deleted_jobs": 0, "doc_deleted": False, "files": None,
             "vectors": None, "chunks_deleted": False}

    class _Job:
        id = "j1"
        document_id = "d1"
        owner_user_id = owner

    class _Doc:
        id = "d1"
        owner_user_id = owner
        raw_path = "/u/d1.pdf"
        parsed_md_path = None

    job = _Job()
    job.status = status

    class _DeleteQuery:
        def __init__(self, model):
            self._model = model

        def filter(self, *a, **k):
            return self

        def delete(self):
            if self._model is documents_router.IngestJob:
                # simulate_race: status チェックは通過したが原子DELETEは0件
                if simulate_race:
                    return 0
                if job.status == "queued":
                    state["deleted_jobs"] = 1
                    return 1
                return 0
            elif self._model is documents_router.Chunk:
                state["chunks_deleted"] = True
                return 0

    class _Session:
        def get(self, model, _id):
            if model is documents_router.IngestJob:
                return job if job_exists else None
            return _Doc()

        def query(self, model):
            return _DeleteQuery(model)

        def delete(self, obj):
            state["doc_deleted"] = True

        def rollback(self):
            pass

        def commit(self):
            pass

        def close(self):
            pass

    class _Qdrant:
        def delete_by_document(self, doc_id):
            state["vectors"] = doc_id

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "QdrantStore", lambda *a, **k: _Qdrant())
    monkeypatch.setattr(documents_router, "cleanup_document_files",
                        lambda raw, md=None: state.update(files=(raw, md)))
    return state


def test_cancel_queued_deletes_job_doc_and_files(client, monkeypatch):
    state = _install_fakes(monkeypatch, status="queued")
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 204
    assert state["deleted_jobs"] == 1
    assert state["vectors"] == "d1"
    assert state["chunks_deleted"] is True
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


def test_cancel_409_when_lost_race(client, monkeypatch):
    """status チェック通過後に Worker が先取りし原子 DELETE が 0 件になるケース → 409"""
    _install_fakes(monkeypatch, status="queued", simulate_race=True)
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 409
