import json
import subprocess
from pathlib import Path

from app.config import settings
from app.parsing.types import ParsedBlock, ParsedDocument

# content_list.json の type → ParsedBlock.type
_TYPE_MAP = {
    "text": "text",
    "title": "title",
    "table": "table",
    "equation": "equation",
    "interline_equation": "equation",
    "image": "image",
}


def _block_from_item(item: dict) -> ParsedBlock | None:
    raw_type = item.get("type", "text")
    btype = _TYPE_MAP.get(raw_type)
    if btype is None:
        return None
    page = int(item.get("page_idx", 0))
    if btype == "title":
        return ParsedBlock(type="title", text=item.get("text", ""),
                           level=int(item.get("text_level", 1)), page=page)
    if btype == "table":
        return ParsedBlock(type="table", html=item.get("table_body", ""),
                           caption=_join(item.get("table_caption")), page=page)
    if btype == "equation":
        return ParsedBlock(type="equation", latex=item.get("text", ""), page=page)
    if btype == "image":
        return ParsedBlock(type="image", caption=_join(item.get("img_caption")), page=page)
    return ParsedBlock(type="text", text=item.get("text", ""), page=page)


def _join(value) -> str | None:
    if value is None:
        return None
    return " ".join(value) if isinstance(value, list) else str(value)


def parse(file_path: str, out_dir: str) -> ParsedDocument:
    """MinerU CLI を実行し content_list.json を正規化して返す。"""
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["mineru", "-p", file_path, "-o", out_dir, "-d", settings.device],
        check=True,
    )
    content_list = next(Path(out_dir).rglob("*_content_list.json"))
    items = json.loads(content_list.read_text(encoding="utf-8"))
    blocks = [b for b in (_block_from_item(it) for it in items) if b is not None]
    page_count = max((b.page for b in blocks), default=0) + 1
    return ParsedDocument(blocks=blocks, page_count=page_count)
