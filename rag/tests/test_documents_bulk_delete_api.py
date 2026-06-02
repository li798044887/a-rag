from app.config import settings
from app.routers import documents as documents_router


def test_bulk_delete_requires_token(client):
    res = client.post("/documents/bulk-delete",
                      json={"owner_user_id": "u1", "document_ids": ["d1"]})
    assert res.status_code == 401


def _install_fakes(monkeypatch, owners):
    """owners: dict id -> owner_user_id（存在しない id はマップに入れない）。"""
    state = {"vectors": [], "Chunk": 0, "IngestJob": 0,
             "docs_deleted": [], "files": [], "activity": 0}

    class _Doc:
        def __init__(self, doc_id, owner):
            self.id = doc_id
            self.owner_user_id = owner
            self.raw_path = f"/u/{doc_id}.pdf"
            self.parsed_md_path = None

    class _Query:
        def __init__(self, model):
            self.model = model

        def filter(self, *a, **k):
            return self

        def delete(self):
            state[self.model.__name__] += 1
            return 1

    class _Session:
        def get(self, model, doc_id):
            owner = owners.get(doc_id)
            return _Doc(doc_id, owner) if owner is not None else None

        def query(self, model):
            return _Query(model)

        def delete(self, obj):
            state["docs_deleted"].append(obj.id)

        def commit(self):
            pass

        def close(self):
            pass

    class _Qdrant:
        def delete_by_document(self, doc_id):
            state["vectors"].append(doc_id)

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "QdrantStore", lambda *a, **k: _Qdrant())
    monkeypatch.setattr(documents_router, "cleanup_document_files",
                        lambda raw, md=None: state["files"].append((raw, md)))
    monkeypatch.setattr(documents_router, "record_workspace_activity",
                        lambda session, *, owner_user_id: state.update(activity=state["activity"] + 1))
    return state


def test_bulk_delete_removes_owned_and_reports_missing(client, monkeypatch):
    # d1,d2 は u1 所有、d3 は不在、d4 は別人所有
    state = _install_fakes(monkeypatch, {"d1": "u1", "d2": "u1", "d4": "owner-B"})
    res = client.post("/documents/bulk-delete",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "u1",
                            "document_ids": ["d1", "d2", "d3", "d4"]})
    assert res.status_code == 200
    body = res.json()
    assert body["deleted"] == ["d1", "d2"]
    assert body["not_found"] == ["d3", "d4"]
    assert state["vectors"] == ["d1", "d2"]
    assert state["Chunk"] == 2
    assert state["IngestJob"] == 2
    assert state["docs_deleted"] == ["d1", "d2"]
    assert state["files"] == [("/u/d1.pdf", None), ("/u/d2.pdf", None)]
    assert state["activity"] == 1


def test_bulk_delete_empty_list_is_noop(client, monkeypatch):
    state = _install_fakes(monkeypatch, {})
    res = client.post("/documents/bulk-delete",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "u1", "document_ids": []})
    assert res.status_code == 200
    assert res.json() == {"deleted": [], "not_found": []}
    assert state["activity"] == 0
