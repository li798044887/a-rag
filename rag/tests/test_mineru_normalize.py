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
