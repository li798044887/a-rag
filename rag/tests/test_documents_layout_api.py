from pathlib import Path

from app.config import settings
from app.documents_service import find_layout_pdf, find_span_pdf, mineru_dir_for
from app.routers import documents as documents_router


def test_find_layout_pdf_locates_nested_file(tmp_path):
    raw = tmp_path / "doc.pdf"
    raw.write_bytes(b"%PDF")
    auto = Path(mineru_dir_for(str(raw))) / "doc" / "auto"
    auto.mkdir(parents=True)
    layout = auto / "doc_layout.pdf"
    layout.write_bytes(b"%PDF-layout")
    found = find_layout_pdf(str(raw))
    assert found == layout


def test_find_layout_pdf_returns_none_when_absent(tmp_path):
    raw = tmp_path / "doc.pdf"
    raw.write_bytes(b"%PDF")
    assert find_layout_pdf(str(raw)) is None


def test_find_span_pdf_locates_nested_file(tmp_path):
    raw = tmp_path / "doc.pdf"
    raw.write_bytes(b"%PDF")
    auto = Path(mineru_dir_for(str(raw))) / "doc" / "auto"
    auto.mkdir(parents=True)
    span = auto / "doc_span.pdf"
    span.write_bytes(b"%PDF-span")
    found = find_span_pdf(str(raw))
    assert found == span


def test_find_span_pdf_returns_none_when_absent(tmp_path):
    raw = tmp_path / "doc.pdf"
    raw.write_bytes(b"%PDF")
    assert find_span_pdf(str(raw)) is None


def test_layout_requires_token(client):
    res = client.get("/documents/d1/layout?owner_user_id=u1")
    assert res.status_code == 401


def test_span_requires_token(client):
    res = client.get("/documents/d1/span?owner_user_id=u1")
    assert res.status_code == 401


def test_layout_streams_pdf(client, monkeypatch, tmp_path):
    layout = tmp_path / "doc_layout.pdf"
    layout.write_bytes(b"%PDF-1.7\nlayout")

    class _Doc:
        owner_user_id = "u1"
        content_hash = "h1"

    class _Content:
        raw_path = str(tmp_path / "doc.pdf")

    class _Session:
        def get(self, model, _id):
            return _Doc() if model.__name__ == "Document" else _Content()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "find_layout_pdf", lambda raw: layout)
    res = client.get("/documents/d1/layout?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF")


def test_span_streams_pdf(client, monkeypatch, tmp_path):
    span = tmp_path / "doc_span.pdf"
    span.write_bytes(b"%PDF-1.7\nspan")

    class _Doc:
        owner_user_id = "u1"
        content_hash = "h1"

    class _Content:
        raw_path = str(tmp_path / "doc.pdf")

    class _Session:
        def get(self, model, _id):
            return _Doc() if model.__name__ == "Document" else _Content()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "find_span_pdf", lambda raw: span)
    res = client.get("/documents/d1/span?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF")


def test_layout_404_when_missing(client, monkeypatch, tmp_path):
    class _Doc:
        owner_user_id = "u1"
        content_hash = "h1"

    class _Content:
        raw_path = str(tmp_path / "doc.pdf")

    class _Session:
        def get(self, model, _id):
            return _Doc() if model.__name__ == "Document" else _Content()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "find_layout_pdf", lambda raw: None)
    res = client.get("/documents/d1/layout?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


def test_span_404_when_missing(client, monkeypatch, tmp_path):
    class _Doc:
        owner_user_id = "u1"
        content_hash = "h1"

    class _Content:
        raw_path = str(tmp_path / "doc.pdf")

    class _Session:
        def get(self, model, _id):
            return _Doc() if model.__name__ == "Document" else _Content()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "find_span_pdf", lambda raw: None)
    res = client.get("/documents/d1/span?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


def test_layout_404_when_not_owner(client, monkeypatch):
    class _Doc:
        owner_user_id = "owner-A"
        raw_path = "/nope.pdf"

    class _Session:
        def get(self, model, _id):
            return _Doc()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.get("/documents/d1/layout?owner_user_id=intruder-B",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


def test_span_404_when_not_owner(client, monkeypatch):
    class _Doc:
        owner_user_id = "owner-A"
        raw_path = "/nope.pdf"

    class _Session:
        def get(self, model, _id):
            return _Doc()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.get("/documents/d1/span?owner_user_id=intruder-B",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
