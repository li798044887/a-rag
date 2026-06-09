import pytest

import app.parsing.mineru as m
from app.config import settings


def test_items_to_blocks_applies_page_offset():
    # ページ分割マージ: 窓内 0 始まりの page_idx に窓開始ページを加算して絶対化する。
    items = [
        {"type": "title", "text": "図", "text_level": 1, "page_idx": 0},
        {"type": "image", "img_path": "images/a.jpg",
         "image_caption": ["図1"], "content": "流入 出口", "page_idx": 1},
    ]
    blocks = m._items_to_blocks(items, page_offset=10)
    assert blocks[0].type == "title" and blocks[0].page == 10
    assert blocks[1].type == "image" and blocks[1].page == 11
    # 図テキストの独立 text ブロックも同じ絶対ページに載る。
    assert blocks[2].type == "text" and blocks[2].page == 11
    assert "流入" in blocks[2].text


def test_items_to_blocks_no_offset_keeps_pages():
    items = [{"type": "text", "text": "本文", "page_idx": 3}]
    blocks = m._items_to_blocks(items)
    assert blocks[0].page == 3


def test_command_pipeline_has_no_url_or_pages(monkeypatch):
    monkeypatch.setattr(settings, "parse_backend", "pipeline")
    cmd = m._mineru_command("/x.pdf", "/out")
    assert cmd[0] == "mineru"
    assert "-u" not in cmd and "-s" not in cmd and "-e" not in cmd
    # device は env で決まるため -d は渡さない（CLI が黙殺する no-op を避ける）。
    assert "-d" not in cmd


def test_command_http_client_requires_url(monkeypatch):
    monkeypatch.setattr(settings, "parse_backend", "hybrid-http-client")
    monkeypatch.setattr(settings, "mineru_server_url", "")
    with pytest.raises(RuntimeError):
        m._mineru_command("/x.pdf", "/out")


def test_command_http_client_adds_url_and_pages(monkeypatch):
    monkeypatch.setattr(settings, "parse_backend", "hybrid-http-client")
    monkeypatch.setattr(settings, "mineru_server_url", "http://srv:30000")
    cmd = m._mineru_command("/x.pdf", "/out", start=0, end=39)
    assert cmd[cmd.index("-u") + 1] == "http://srv:30000"
    assert cmd[cmd.index("-s") + 1] == "0"
    assert cmd[cmd.index("-e") + 1] == "39"
