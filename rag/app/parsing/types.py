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


@dataclass
class ParsedDocument:
    blocks: list[ParsedBlock]
    page_count: int


@dataclass
class Chunk:
    ordinal: int
    heading_path: str
    page_start: int
    page_end: int
    block_type: str  # "text" | "table" | "equation" | "image"
    text: str
    token_len: int
