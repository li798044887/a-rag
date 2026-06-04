from app.parsing.mineru import _block_from_item


def test_title_item_maps_to_title_block_with_level():
    b = _block_from_item({"type": "title", "text": "概要", "text_level": 2, "page_idx": 1})
    assert b.type == "title" and b.level == 2 and b.page == 1


def test_table_item_keeps_html_and_caption():
    b = _block_from_item({"type": "table", "table_body": "<table></table>",
                          "table_caption": ["表1"], "page_idx": 0})
    assert b.type == "table" and b.html == "<table></table>" and b.caption == "表1"


def test_unknown_type_is_dropped():
    assert _block_from_item({"type": "page_footer", "text": "1"}) is None


def test_image_item_keeps_path_and_caption():
    b = _block_from_item({"type": "image", "img_path": "images/x.jpg",
                          "img_caption": ["図1"], "page_idx": 2})
    assert b.type == "image"
    assert b.image_path == "images/x.jpg"
    assert b.caption == "図1"
    assert b.page == 2


def test_image_item_without_path_has_none():
    b = _block_from_item({"type": "image", "page_idx": 0})
    assert b.type == "image" and b.image_path is None


def test_list_item_joins_list_items_into_text():
    # PPTX/Office の箇条書きは list_items（整形済み文字列の配列）として出る
    b = _block_from_item({"type": "list",
                          "list_items": ["- 項目1", "- 項目2", "    - 入れ子"],
                          "page_idx": 3})
    assert b.type == "text"
    assert b.text == "- 項目1\n- 項目2\n    - 入れ子"
    assert b.page == 3


def test_index_item_joins_list_items_into_text():
    # DOCX の目次（index）も list_items 構造で出るため取りこぼさない
    b = _block_from_item({"type": "index",
                          "list_items": ["1. 概要", "2. 詳細"], "page_idx": 0})
    assert b.type == "text"
    assert b.text == "1. 概要\n2. 詳細"


def test_list_item_without_items_is_empty_text():
    b = _block_from_item({"type": "list", "page_idx": 1})
    assert b.type == "text" and b.text == "" and b.page == 1
