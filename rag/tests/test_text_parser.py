from pathlib import Path

from app.parsing.text import parse as text_parse


def _write(tmp_path, name: str, body: str) -> str:
    p = Path(tmp_path) / name
    p.write_text(body, encoding="utf-8")
    return str(p)


def test_markdown_headings_become_title_blocks_with_level(tmp_path):
    path = _write(tmp_path, "a.md", "# 概要\n\n本文です。\n\n## 詳細\n段落2")
    doc = text_parse(path, str(tmp_path))
    kinds = [(b.type, b.level, b.text) for b in doc.blocks]
    assert ("title", 1, "概要") in kinds
    assert ("title", 2, "詳細") in kinds
    assert any(b.type == "text" and "本文です。" in b.text for b in doc.blocks)


def test_markdown_paragraphs_split_on_blank_lines(tmp_path):
    path = _write(tmp_path, "a.md", "段落1の行1\n段落1の行2\n\n段落2")
    doc = text_parse(path, str(tmp_path))
    texts = [b.text for b in doc.blocks if b.type == "text"]
    assert "段落1の行1\n段落1の行2" in texts
    assert "段落2" in texts


def test_plain_txt_has_no_titles(tmp_path):
    path = _write(tmp_path, "a.txt", "# これは見出しではない\n\nただのテキスト")
    doc = text_parse(path, str(tmp_path))
    assert all(b.type == "text" for b in doc.blocks)
    assert any("# これは見出しではない" in b.text for b in doc.blocks)


def test_parsed_document_has_single_page_and_no_images_dir(tmp_path):
    path = _write(tmp_path, "a.md", "# 見出し\n本文")
    doc = text_parse(path, str(tmp_path))
    assert doc.page_count == 1
    assert doc.images_dir is None


def test_empty_file_yields_no_blocks(tmp_path):
    path = _write(tmp_path, "a.txt", "\n\n  \n")
    doc = text_parse(path, str(tmp_path))
    assert doc.blocks == []
