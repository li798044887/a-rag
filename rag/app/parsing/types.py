from dataclasses import dataclass


@dataclass
class ParsedBlock:
    """MinerU 出力を正規化した 1 ブロック。"""
    type: str  # "title" | "text" | "table" | "equation" | "image"
    text: str = ""
    level: int | None = None  # title のときの見出しレベル（1 が最上位）
    page: int = 0
    html: str | None = None   # table の HTML
    latex: str | None = None  # equation の LaTeX
    caption: str | None = None  # table/image のキャプション
    image_path: str | None = None  # image の相対パス（例 "images/x.jpg"）
    ocr_text: str | None = None  # OCR による画像内文字認識結果


@dataclass
class ParsedDocument:
    blocks: list[ParsedBlock]
    page_count: int
    images_dir: str | None = None  # MinerU が画像を書き出したディレクトリ（images/ の親）


@dataclass
class Chunk:
    ordinal: int
    heading_path: str
    page_start: int
    page_end: int
    block_type: str  # "text" | "table" | "equation" | "image"
    text: str
    token_len: int
