import json
import shutil
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


def _items_to_blocks(items: list[dict], page_offset: int = 0) -> list[ParsedBlock]:
    """content_list の items を ParsedBlock 列へ正規化する。

    page_offset はページ分割時に窓内 0 始まりの page_idx を絶対ページへ補正する
    （MinerU は -s/-e 指定でも PDF を切り出し直して 0 始まりで page_idx を振るため）。
    """
    blocks: list[ParsedBlock] = []
    for it in items:
        block = _block_from_item(it)
        if block is None:
            continue
        if page_offset:
            block.page += page_offset
        blocks.append(block)
        # 画像は表示用に残しつつ、VLM 抽出の図表テキストを索引対象の text として展開する。
        if block.type == "image":
            figure = _figure_text(it)
            if figure:
                blocks.append(ParsedBlock(type="text", text=figure, page=block.page))
    return blocks


def _mineru_command(file_path: str, out_dir: str, *,
                    start: int | None = None, end: int | None = None) -> list[str]:
    """mineru CLI 引数を組み立てる。

    -b: settings.parse_backend で切替。
      pipeline … CPU/レイアウト解析のみ（dev 既定）。content_list.json を出力。
      hybrid-auto-engine … VLM + 構造解析を in-process で実行（VLM cold 起動で VRAM スパイク大）。
      hybrid-http-client … 常駐 mineru-vllm サーバへ HTTP 接続（-u 必須）。VLM を抱えず VRAM を専有しない。
    device は env(MINERU_DEVICE_MODE)/auto 検出で決まる。CLI は未知オプションを黙殺するため -d は渡さない。
    """
    cmd = ["mineru", "-p", file_path, "-o", out_dir, "-b", settings.parse_backend]
    if settings.parse_backend.endswith("http-client"):
        if not settings.mineru_server_url:
            raise RuntimeError(
                "http-client バックエンドには MINERU_SERVER_URL（mineru-vllm サーバ URL）が必要です。")
        cmd += ["-u", settings.mineru_server_url]
    if start is not None:
        cmd += ["-s", str(start)]
    if end is not None:
        cmd += ["-e", str(end)]
    return cmd


def _content_list(out_dir: str) -> Path:
    files = sorted(Path(out_dir).rglob("*_content_list.json"))
    if not files:
        raise FileNotFoundError(f"no *_content_list.json found under {out_dir}")
    return files[-1]


def _pdf_page_count(file_path: str) -> int:
    import pypdfium2 as pdfium  # MinerU 依存。ここでだけ使う。
    pdf = pdfium.PdfDocument(file_path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def parse(file_path: str, out_dir: str) -> ParsedDocument:
    """MinerU CLI を実行し content_list.json を正規化して返す。

    PDF かつ MINERU_PAGE_WINDOW>0 で総ページ数が窓を超える場合は、ページ窓ごとに
    分割実行してピーク RAM を頭打ちにする（画像入り大判 PDF の RAM 枯渇対策）。
    """
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    window = settings.mineru_page_window
    # ページ分割は PDF のみ（office/画像はページ単位スライスが不確実なため一括）。
    if window > 0 and Path(file_path).suffix.lower() == ".pdf":
        page_count = _pdf_page_count(file_path)
        if page_count > window:
            return _parse_windowed(file_path, out_dir, page_count, window)
    return _parse_once(file_path, out_dir)


def _parse_once(file_path: str, out_dir: str) -> ParsedDocument:
    subprocess.run(_mineru_command(file_path, out_dir), check=True)
    content_list = _content_list(out_dir)
    items = json.loads(content_list.read_text(encoding="utf-8"))
    blocks = _items_to_blocks(items)
    page_count = max((b.page for b in blocks), default=0) + 1
    return ParsedDocument(blocks=blocks, page_count=page_count,
                          images_dir=str(content_list.parent))


def _parse_windowed(file_path: str, out_dir: str,
                    page_count: int, window: int) -> ParsedDocument:
    """ページ窓ごとに mineru を回し、ページ番号を絶対値へ補正してブロックと画像を統合する。

    各窓は独立サブディレクトリへ出力し、画像は単一の images/ へ集約する。
    画像名は内容ハッシュで一意なため、窓をまたいで衝突しても同一実体で上書き互換。
    img_path は "images/<name>" のままなので worker の _copy_assets と整合する。
    """
    merged_root = Path(out_dir) / "merged"
    merged_images = merged_root / "images"
    merged_images.mkdir(parents=True, exist_ok=True)
    blocks: list[ParsedBlock] = []
    for start in range(0, page_count, window):
        end = min(start + window - 1, page_count - 1)
        win_out = str(Path(out_dir) / f"win_{start:04d}")
        subprocess.run(
            _mineru_command(file_path, win_out, start=start, end=end), check=True)
        content_list = _content_list(win_out)
        items = json.loads(content_list.read_text(encoding="utf-8"))
        blocks.extend(_items_to_blocks(items, page_offset=start))
        src_images = content_list.parent / "images"
        if src_images.is_dir():
            for img in src_images.iterdir():
                if img.is_file():
                    shutil.copy2(img, merged_images / img.name)
    page_count = max((b.page for b in blocks), default=0) + 1
    return ParsedDocument(blocks=blocks, page_count=page_count,
                          images_dir=str(merged_root))
