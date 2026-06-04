from app.config import settings
from app.documents_service import assets_dir_for
from app.routers import documents as documents_router

TOKEN_HEADER = {"x-internal-token": settings.rag_internal_token}


def _patch_doc(monkeypatch, owner: str, raw_path: str):
    class _Doc:
        owner_user_id = owner
        content_hash = "h1"
        filename = "doc.pdf"

    class _Content:
        mime = "application/pdf"

    _Content.raw_path = raw_path

    class _Session:
        def get(self, model, _id):
            return _Doc() if model.__name__ == "Document" else _Content()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())


def test_assets_requires_token(client):
    res = client.get("/documents/d1/assets/images/x.png")
    assert res.status_code == 401


def test_assets_returns_file(client, monkeypatch, tmp_path):
    raw = tmp_path / "doc.pdf"
    base = tmp_path / "doc_assets" / "images"
    base.mkdir(parents=True)
    (base / "x.png").write_bytes(b"\x89PNG\r\n")
    assert assets_dir_for(str(raw)) == str(tmp_path / "doc_assets")
    _patch_doc(monkeypatch, owner="u1", raw_path=str(raw))

    res = client.get("/documents/d1/assets/images/x.png?owner_user_id=u1",
                     headers=TOKEN_HEADER)
    assert res.status_code == 200
    assert res.content.startswith(b"\x89PNG")


def test_assets_404_when_not_owner(client, monkeypatch, tmp_path):
    _patch_doc(monkeypatch, owner="owner-A", raw_path=str(tmp_path / "doc.pdf"))
    res = client.get("/documents/d1/assets/images/x.png?owner_user_id=intruder-B",
                     headers=TOKEN_HEADER)
    assert res.status_code == 404


def test_assets_404_when_missing_file(client, monkeypatch, tmp_path):
    _patch_doc(monkeypatch, owner="u1", raw_path=str(tmp_path / "doc.pdf"))
    res = client.get("/documents/d1/assets/images/nope.png?owner_user_id=u1",
                     headers=TOKEN_HEADER)
    assert res.status_code == 404
