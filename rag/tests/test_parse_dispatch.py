import pytest

from app.parsing.dispatch import parse_document


def test_text_extension_uses_text_parser_not_mineru(tmp_path, monkeypatch):
    # MinerU を呼んだら失敗させる: テキスト系で呼ばれないことを保証する。
    import app.parsing.dispatch as dispatch

    def _boom(*_args, **_kwargs):
        raise AssertionError("MinerU should not be called for text formats")

    monkeypatch.setattr(dispatch, "mineru_parse", _boom)
    md = tmp_path / "note.md"
    md.write_text("# 見出し\n本文", encoding="utf-8")

    doc = parse_document(str(md), str(tmp_path / "out"))
    assert any(b.type == "title" and b.text == "見出し" for b in doc.blocks)


def test_document_extension_delegates_to_mineru(tmp_path, monkeypatch):
    import app.parsing.dispatch as dispatch
    from app.parsing.types import ParsedDocument

    called: dict = {}

    def _fake_mineru(file_path: str, out_dir: str) -> ParsedDocument:
        called["args"] = (file_path, out_dir)
        return ParsedDocument(blocks=[], page_count=1)

    monkeypatch.setattr(dispatch, "mineru_parse", _fake_mineru)
    pdf = tmp_path / "report.pdf"
    pdf.write_bytes(b"%PDF-1.7")

    parse_document(str(pdf), "/tmp/out")
    assert called["args"] == (str(pdf), "/tmp/out")


def test_unsupported_extension_raises_clear_error(tmp_path):
    bad = tmp_path / "archive.zip"
    bad.write_bytes(b"PK\x03\x04")
    with pytest.raises(ValueError, match="zip"):
        parse_document(str(bad), str(tmp_path / "out"))
