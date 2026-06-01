from pathlib import Path

from app.parsing.mineru import parse as mineru_parse
from app.parsing.text import parse as text_parse
from app.parsing.types import ParsedDocument

# MinerU CLI がサポートする入力（--help: pdf, image, docx, pptx, xlsx）。
MINERU_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".docx", ".pptx", ".xlsx"}
# プレーンテキスト系は MinerU を介さず直接読む。
TEXT_EXTS = {".md", ".txt", ".json", ".csv"}


def parse_document(file_path: str, out_dir: str) -> ParsedDocument:
    """拡張子で解析器を振り分ける。テキスト系は MinerU を介さない。"""
    ext = Path(file_path).suffix.lower()
    if ext in TEXT_EXTS:
        return text_parse(file_path, out_dir)
    if ext in MINERU_EXTS:
        return mineru_parse(file_path, out_dir)
    raise ValueError(f"未対応の形式です: {ext or file_path}")
