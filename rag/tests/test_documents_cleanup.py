from pathlib import Path

from app.documents_service import (
    assets_dir_for,
    cleanup_document_files,
    mineru_dir_for,
)


def test_mineru_dir_for_is_sibling_of_assets():
    raw = "/data/uploads/abc_report.pdf"
    assert mineru_dir_for(raw) == "/data/uploads/abc_report_mineru"
    assert assets_dir_for(raw) == "/data/uploads/abc_report_assets"


def test_cleanup_removes_raw_assets_mineru_and_parsed_md(tmp_path):
    raw = tmp_path / "abc_report.pdf"
    raw.write_bytes(b"%PDF")
    assets = Path(assets_dir_for(str(raw)))
    (assets / "images").mkdir(parents=True)
    (assets / "images" / "0.jpg").write_bytes(b"img")
    mineru = Path(mineru_dir_for(str(raw)))
    mineru.mkdir()
    (mineru / "layout.json").write_text("{}")
    parsed_md = tmp_path / "abc_report.md"
    parsed_md.write_text("# md")

    cleanup_document_files(str(raw), str(parsed_md))

    assert not raw.exists()
    assert not assets.exists()
    assert not mineru.exists()
    assert not parsed_md.exists()


def test_cleanup_is_best_effort_on_missing_paths():
    # 存在しないパスでも例外を投げない
    cleanup_document_files("/nonexistent/x.pdf", None)
