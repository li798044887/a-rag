from pathlib import Path

from app.config import settings
from app.documents_service import is_convertible, rendered_pdf_for
from app.routers import documents as documents_router


# --- 純関数 ---

def test_is_convertible_true_for_office_formats():
    for name in ["a.docx", "a.doc", "a.xlsx", "a.xls", "a.pptx",
                 "a.ppt", "a.odt", "a.ods", "a.odp", "a.rtf",
                 "/data/uploads/x_REPORT.XLSX"]:
        assert is_convertible(name), name


def test_is_convertible_false_for_already_previewable_or_unknown():
    for name in ["a.pdf", "a.png", "a.jpg", "a.txt", "a.md", "a.csv", "noext"]:
        assert not is_convertible(name), name


def test_rendered_pdf_for_is_sibling_of_raw():
    raw = "/data/uploads/abc_sheet.xlsx"
    assert rendered_pdf_for(raw) == Path("/data/uploads/abc_sheet_rendered.pdf")


# --- エンドポイント ---

def _fake_doc(owner="u1", raw_path="/data/uploads/x_sheet.xlsx",
              filename="sheet.xlsx", mime="application/vnd.ms-excel"):
    class _Doc:
        pass
    d = _Doc()
    d.owner_user_id = owner
    d.raw_path = raw_path
    d.filename = filename
    d.mime = mime
    return d


def _fake_session(doc):
    class _Session:
        def get(self, model, _id):
            return doc
        def close(self):
            pass
    return _Session()


def test_rendered_requires_token(client):
    res = client.get("/documents/d1/rendered?owner_user_id=u1")
    assert res.status_code == 401


def test_rendered_404_when_not_owner(client, monkeypatch):
    monkeypatch.setattr(documents_router, "SessionLocal",
                        lambda: _fake_session(_fake_doc(owner="owner-A")))
    res = client.get("/documents/d1/rendered?owner_user_id=intruder-B",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


def test_rendered_404_for_non_convertible_format(client, monkeypatch):
    doc = _fake_doc(raw_path="/data/uploads/x.pdf", filename="x.pdf",
                    mime="application/pdf")
    monkeypatch.setattr(documents_router, "SessionLocal",
                        lambda: _fake_session(doc))
    res = client.get("/documents/d1/rendered?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


def test_rendered_422_when_conversion_fails(client, monkeypatch, tmp_path):
    raw = tmp_path / "x_sheet.xlsx"
    raw.write_bytes(b"xlsxdata")
    doc = _fake_doc(raw_path=str(raw))
    monkeypatch.setattr(documents_router, "SessionLocal",
                        lambda: _fake_session(doc))

    def boom(_raw):
        raise RuntimeError("soffice failed")
    monkeypatch.setattr(documents_router, "convert_to_pdf", boom)

    res = client.get("/documents/d1/rendered?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 422


def test_rendered_returns_pdf_on_success(client, monkeypatch, tmp_path):
    raw = tmp_path / "x_sheet.xlsx"
    raw.write_bytes(b"xlsxdata")
    pdf = tmp_path / "x_sheet_rendered.pdf"
    pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
    doc = _fake_doc(raw_path=str(raw))
    monkeypatch.setattr(documents_router, "SessionLocal",
                        lambda: _fake_session(doc))
    monkeypatch.setattr(documents_router, "convert_to_pdf", lambda _raw: pdf)

    res = client.get("/documents/d1/rendered?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF")
