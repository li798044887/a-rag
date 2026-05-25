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
