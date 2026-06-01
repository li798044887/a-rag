import re
from pathlib import Path

from app.parsing.types import ParsedBlock, ParsedDocument

# Markdown 見出し（# 〜 ######）。先頭の # の数を見出しレベルとする。
_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")


def _flush(para: list[str], blocks: list[ParsedBlock]) -> None:
    body = "\n".join(para).strip()
    if body:
        blocks.append(ParsedBlock(type="text", text=body, page=0))
    para.clear()


def _parse_markdown(text: str) -> list[ParsedBlock]:
    """見出しを title、空行区切りの段落を text ブロックにする軽量パーサ。"""
    blocks: list[ParsedBlock] = []
    para: list[str] = []
    for line in text.splitlines():
        m = _HEADING.match(line)
        if m:
            _flush(para, blocks)
            blocks.append(ParsedBlock(type="title", text=m.group(2).strip(),
                                      level=len(m.group(1)), page=0))
        elif not line.strip():
            _flush(para, blocks)
        else:
            para.append(line)
    _flush(para, blocks)
    return blocks


def _parse_plain(text: str) -> list[ParsedBlock]:
    """空行区切りの段落をそのまま text ブロックにする（見出し解釈なし）。"""
    blocks: list[ParsedBlock] = []
    for para in re.split(r"\n\s*\n", text):
        body = para.strip()
        if body:
            blocks.append(ParsedBlock(type="text", text=body, page=0))
    return blocks


def parse(file_path: str, _out_dir: str | None = None) -> ParsedDocument:
    """プレーンテキスト系（.md/.txt/.json/.csv）を MinerU を介さず解析する。

    テキストは既にプレーンなので OCR/レイアウト解析は不要。.md のみ見出しを
    解釈し、その他は段落単位の text ブロックに正規化する。out_dir は
    MinerU パスと同じシグネチャに合わせるためのダミー（未使用）。"""
    text = Path(file_path).read_text(encoding="utf-8", errors="replace")
    ext = Path(file_path).suffix.lower()
    blocks = _parse_markdown(text) if ext == ".md" else _parse_plain(text)
    return ParsedDocument(blocks=blocks, page_count=1, images_dir=None)
