from pathlib import Path

from app.documents_service import assets_dir_for, resolve_within


def test_assets_dir_for_strips_suffix_and_appends_assets():
    assert assets_dir_for("/data/uploads/abc_doc.pdf") == "/data/uploads/abc_doc_assets"


def test_resolve_within_allows_paths_under_base(tmp_path):
    base = tmp_path / "doc_assets"
    (base / "images").mkdir(parents=True)
    f = base / "images" / "x.png"
    f.write_bytes(b"x")
    got = resolve_within(str(base), "images/x.png")
    assert got == f.resolve()


def test_resolve_within_rejects_parent_traversal(tmp_path):
    base = tmp_path / "doc_assets"
    base.mkdir()
    (tmp_path / "secret.txt").write_text("nope")
    assert resolve_within(str(base), "../secret.txt") is None


def test_resolve_within_rejects_absolute_escape(tmp_path):
    base = tmp_path / "doc_assets"
    base.mkdir()
    assert resolve_within(str(base), "/etc/passwd") is None
