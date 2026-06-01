from pathlib import Path

from app.config import settings
from app import documents_service
from app.documents_service import convert_to_pdf, is_convertible, rendered_pdf_for
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


def test_convert_to_pdf_works_into_cache(tmp_path, monkeypatch):
    """soffice をモックし、生成 PDF がキャッシュパスへ確定されること。"""
    raw = tmp_path / "x_sheet.xlsx"
    raw.write_bytes(b"xlsxdata")
    captured = {}

    def fake_run(cmd, **kw):
        outdir = Path(cmd[cmd.index("--outdir") + 1])
        captured["outdir"] = outdir
        (outdir / (raw.stem + ".pdf")).write_bytes(b"%PDF-1.4\n%%EOF\n")
        class _R:
            returncode = 0
            stdout = b""
            stderr = b""
        return _R()

    monkeypatch.setattr(documents_service.subprocess, "run", fake_run)
    out = convert_to_pdf(str(raw))
    assert out == rendered_pdf_for(str(raw))
    assert out.is_file() and out.read_bytes().startswith(b"%PDF")


def test_convert_to_pdf_uses_dest_filesystem_for_tempdir(tmp_path, monkeypatch):
    """回帰防止: 一時出力は出力先と同じFS（cache.parent）配下に作る。

    /tmp 配下に作ると Docker ボリューム(/data/uploads)へ os.replace する際に
    cross-device link (Errno 18) で失敗する。"""
    raw = tmp_path / "x_sheet.xlsx"
    raw.write_bytes(b"xlsxdata")
    captured = {}

    def fake_run(cmd, **kw):
        outdir = Path(cmd[cmd.index("--outdir") + 1])
        captured["outdir"] = outdir
        (outdir / (raw.stem + ".pdf")).write_bytes(b"%PDF-1.4\n")
        class _R:
            returncode = 0
            stdout = b""
            stderr = b""
        return _R()

    monkeypatch.setattr(documents_service.subprocess, "run", fake_run)
    convert_to_pdf(str(raw))
    # 一時ディレクトリは出力先(rendered pdf)と同じ親ディレクトリ配下にある
    assert captured["outdir"].parent == rendered_pdf_for(str(raw)).parent


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
