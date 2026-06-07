import json
import subprocess
from pathlib import Path

from app.config import settings
from app.parsing.types import ParsedBlock, ParsedDocument

# content_list.json の type → ParsedBlock.type
# PPTX/Office の箇条書き本文（list）と DOCX の目次（index）は list_items 構造で出るため
# text として取り込む（未マップだと正規化後に本文が丸ごと落ちる）。
_TYPE_MAP = {
    "text": "text",
    "title": "title",
    "table": "table",
    "equation": "equation",
    "interline_equation": "equation",
    "image": "image",
    "list": "text",
    "index": "text",
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
        # hybrid(VLM) の content_list は caption を image_caption に格納する。
        # 旧来の img_caption も保険で見る。
        return ParsedBlock(type="image", image_path=item.get("img_path"),
                           caption=_join(item.get("image_caption")
                                         or item.get("img_caption")), page=page)
    # text 系（text / list / index）。list・index は整形済みの list_items を改行で連結する。
    text = item.get("text", "")
    if not text:
        items = item.get("list_items")
        if isinstance(items, list):
            text = "\n".join(str(s) for s in items)
    return ParsedBlock(type="text", text=text, page=page)


def _join(value) -> str | None:
    if value is None:
        return None
    return " ".join(value) if isinstance(value, list) else str(value)


def _figure_text(item: dict) -> str:
    """hybrid(VLM) が画像から抽出した図表テキストを連結して返す。

    image チャンクは表示専用で Qdrant 索引から除外される（worker.py）ため、
    図中テキストを索引へ載せるには独立の text ブロックとして展開する必要がある。
    VLM 解釈の caption（image_caption）と構造化転写（content; 例 mermaid フローチャート）
    を結合する。pipeline ではどちらも空なので "" を返し、追加ブロックは生成しない。
    """
    parts = []
    caption = _join(item.get("image_caption") or item.get("img_caption"))
    if caption:
        parts.append(caption)
    content = item.get("content")
    if isinstance(content, str) and content.strip():
        parts.append(content.strip())
    return "\n".join(parts).strip()


def parse(file_path: str, out_dir: str) -> ParsedDocument:
    """MinerU CLI を実行し content_list.json を正規化して返す。"""
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    # -b: settings.parse_backend で切替。
    #   pipeline … CPU/レイアウト解析のみ（dev 既定）。content_list.json を出力。
    #   hybrid-auto-engine … VLM + 構造解析（prod/CUDA）。--image-analysis(既定有効) で図表も解釈。
    subprocess.run(
        ["mineru", "-p", file_path, "-o", out_dir,
         "-d", settings.device, "-b", settings.parse_backend],
        check=True,
    )
    files = sorted(Path(out_dir).rglob("*_content_list.json"))
    if not files:
        raise FileNotFoundError(f"no *_content_list.json found under {out_dir}")
    content_list = files[-1]
    items = json.loads(content_list.read_text(encoding="utf-8"))
    blocks: list[ParsedBlock] = []
    for it in items:
        block = _block_from_item(it)
        if block is None:
            continue
        blocks.append(block)
        # 画像は表示用に残しつつ、VLM 抽出の図表テキストを索引対象の text として展開する。
        if block.type == "image":
            figure = _figure_text(it)
            if figure:
                blocks.append(ParsedBlock(type="text", text=figure, page=block.page))
    page_count = max((b.page for b in blocks), default=0) + 1
    return ParsedDocument(blocks=blocks, page_count=page_count,
                          images_dir=str(content_list.parent))
