from app.config import settings
from app.routers import documents as documents_router


def test_delete_requires_token(client):
    res = client.delete("/documents/d1?owner_user_id=u1")
    assert res.status_code == 401


def _install_fakes(monkeypatch, owner="u1"):
    deleted = {"vectors": None, "chunks": False, "jobs": False, "doc": False, "files": None}

    class _Doc:
        id = "d1"
        owner_user_id = owner
        raw_path = "/u/d1.pdf"
        parsed_md_path = None

    class _Filter:
        def __init__(self, kind):
            self.kind = kind

        def delete(self):
            deleted[self.kind] = True

    class _Session:
        def get(self, model, _id):
            return _Doc()

        def query(self, model):
            return self

        def filter(self, *a, **k):
            # Chunk か IngestJob かは呼ばれた順で区別せず両方フラグ立て
            return _Filter("chunks") if not deleted["chunks"] else _Filter("jobs")

        def delete(self, obj):
            deleted["doc"] = True

        def commit(self):
            pass

        def close(self):
            pass

    class _Qdrant:
        def delete_by_document(self, doc_id):
            deleted["vectors"] = doc_id

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "QdrantStore", lambda *a, **k: _Qdrant())
    monkeypatch.setattr(documents_router, "cleanup_document_files",
                        lambda raw, md=None: deleted.update(files=(raw, md)))
    return deleted


def test_delete_removes_vectors_chunks_jobs_doc_and_files(client, monkeypatch):
    deleted = _install_fakes(monkeypatch)
    activity = {}
    monkeypatch.setattr(documents_router, "record_workspace_activity",
                        lambda session, *, owner_user_id: activity.update(owner_user_id=owner_user_id))
    res = client.delete("/documents/d1?owner_user_id=u1",
                        headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 204
    assert deleted["vectors"] == "d1"
    assert deleted["chunks"] is True
    assert deleted["jobs"] is True
    assert deleted["doc"] is True
    assert deleted["files"] == ("/u/d1.pdf", None)
    assert activity == {"owner_user_id": "u1"}


def test_delete_404_when_not_owner(client, monkeypatch):
    _install_fakes(monkeypatch, owner="owner-A")
    res = client.delete("/documents/d1?owner_user_id=intruder-B",
                        headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
