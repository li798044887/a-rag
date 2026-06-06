from app.parsing.types import ParsedBlock
from app.parsing.mineru import _block_from_item
from app.chunking.chunker import chunk_blocks, estimate_tokens


def title(text, level):
    return ParsedBlock(type="title", text=text, level=level, page=0)


def text(t, page=0):
    return ParsedBlock(type="text", text=t, page=page)


def test_estimate_tokens_counts_cjk_per_char():
    assert estimate_tokens("あいうえお") == 5
    assert estimate_tokens("hello world") == 2  # 2 語


def test_heading_path_is_built_from_title_hierarchy():
    blocks = [
        title("設計指針", 1),
        title("認証", 2),
        text("トークンは 24 時間で失効する。"),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 1
    assert chunks[0].heading_path == "設計指針 > 認証"
    assert "トークンは" in chunks[0].text


def test_sibling_title_pops_same_level():
    blocks = [
        title("設計指針", 1),
        title("認証", 2),
        text("A。"),
        title("ロギング", 2),  # 認証(level2) を pop して置換
        text("B。"),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    paths = [c.heading_path for c in chunks]
    assert paths == ["設計指針 > 認証", "設計指針 > ロギング"]


def test_table_is_an_atomic_chunk_with_heading_and_caption():
    blocks = [
        title("売上", 1),
        ParsedBlock(type="table", html="<table><tr><td>Q1</td></tr></table>",
                    caption="四半期売上", page=2),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 1
    c = chunks[0]
    assert c.block_type == "table"
    assert "四半期売上" in c.text          # キャプション同梱
    assert "<table>" in c.text             # HTML を分割しない
    assert c.heading_path == "売上"
    assert c.page_start == 2 and c.page_end == 2


def test_long_text_splits_on_sentence_boundary_with_overlap():
    body = "".join(f"これは第{i}文です。" for i in range(1, 11))  # 10 文
    blocks = [title("章", 1), text(body)]
    chunks = chunk_blocks(blocks, target_tokens=30, overlap_sentences=1)
    assert len(chunks) >= 2
    # 文の途中で切れない（必ず「。」で終わる）
    for c in chunks:
        assert c.text.rstrip().endswith("。")
    # オーバーラップ: 隣接チャンクが 1 文を共有
    assert chunks[0].text.split("。")[-2] + "。" in chunks[1].text


def test_image_with_path_becomes_markdown_image():
    blocks = [
        title("図", 1),
        ParsedBlock(type="image", image_path="images/a.jpg", caption="冷却図", page=3),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 1
    c = chunks[0]
    assert c.block_type == "image"
    assert c.text == "![冷却図](images/a.jpg)"
    assert c.page_start == 3 and c.page_end == 3


def test_image_without_caption_has_empty_alt():
    blocks = [ParsedBlock(type="image", image_path="images/b.png", page=0)]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert chunks[0].text == "![](images/b.png)"


def test_image_without_path_falls_back_to_placeholder():
    blocks = [ParsedBlock(type="image", caption=None, page=0)]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert chunks[0].text == "[image]"


def test_pptx_list_body_survives_normalize_and_chunking():
    # 回帰: PPTX 本文（list）が正規化＋チャンク化を通って text チャンクに残ることを保証する。
    items = [
        {"type": "title", "text": "提案概要", "text_level": 1, "page_idx": 0},
        {"type": "list",
         "list_items": ["- 導入コストの削減。", "- 検索精度の向上。"],
         "page_idx": 0},
    ]
    blocks = [b for b in (_block_from_item(it) for it in items) if b is not None]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert any("導入コストの削減" in c.text and "検索精度の向上" in c.text
               and c.block_type == "text" for c in chunks)


def test_image_with_ocr_emits_ocr_chunk():
    blocks = [
        title("図", 1),
        ParsedBlock(type="image", image_path="images/a.jpg",
                    caption="冷却図", page=3, ocr_text="図1: 冷却システム\n流入 出口"),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 2
    image_chunks = [c for c in chunks if c.block_type == "image"]
    ocr_chunks = [c for c in chunks if c.block_type == "image_ocr"]
    assert len(image_chunks) == 1
    assert len(ocr_chunks) == 1
    assert image_chunks[0].text == "![冷却図](images/a.jpg)"
    assert ocr_chunks[0].text == "図1: 冷却システム\n流入 出口"
    assert ocr_chunks[0].heading_path == "図"
    assert ocr_chunks[0].page_start == 3


def test_image_without_ocr_does_not_emit_ocr_chunk():
    blocks = [
        ParsedBlock(type="image", image_path="images/b.png", page=0, ocr_text=None),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    types = {c.block_type for c in chunks}
    assert "image_ocr" not in types
    assert len(chunks) == 1


def test_image_with_empty_ocr_text_does_not_emit_ocr_chunk():
    blocks = [
        ParsedBlock(type="image", image_path="images/c.png", page=0, ocr_text=""),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    types = {c.block_type for c in chunks}
    assert "image_ocr" not in types
