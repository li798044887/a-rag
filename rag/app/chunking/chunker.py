import re

from app.parsing.types import Chunk, ParsedBlock

_CJK = re.compile(r"[぀-ヿ一-鿿가-힣]")
_SENT_END = re.compile(r"(?<=[。！？!?])")


def estimate_tokens(text: str) -> int:
    """CJK は 1 文字 1 トークン、非 CJK は空白区切りの語数で概算。"""
    cjk = len(_CJK.findall(text))
    non_cjk = _CJK.sub(" ", text)
    words = len([w for w in non_cjk.split() if w])
    return cjk + words


def _split_sentences(text: str) -> list[str]:
    parts = [s for s in _SENT_END.split(text) if s.strip()]
    return parts or ([text] if text.strip() else [])


def _heading_path(stack: list[tuple[int, str]]) -> str:
    return " > ".join(t for _, t in stack)


def chunk_blocks(
    blocks: list[ParsedBlock],
    target_tokens: int = 700,
    overlap_sentences: int = 1,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    stack: list[tuple[int, str]] = []
    ordinal = 0

    # テキストバッファ（連続する text ブロックを束ねる）
    buf: list[str] = []
    buf_pages: list[int] = []

    def flush_text() -> None:
        nonlocal ordinal, buf, buf_pages
        if not buf:
            return
        sentences: list[str] = []
        for para in buf:
            sentences.extend(_split_sentences(para))
        pages = buf_pages or [0]
        page_start, page_end = min(pages), max(pages)

        cur: list[str] = []
        cur_tokens = 0
        for sent in sentences:
            st = estimate_tokens(sent)
            if cur and cur_tokens + st > target_tokens:
                _emit_text(cur, page_start, page_end)
                # オーバーラップ: 末尾 N 文を次へ持ち越す
                cur = cur[-overlap_sentences:] if overlap_sentences else []
                cur_tokens = sum(estimate_tokens(s) for s in cur)
            cur.append(sent)
            cur_tokens += st
        if cur:
            _emit_text(cur, page_start, page_end)
        buf = []
        buf_pages = []

    def _emit_text(sentences: list[str], page_start: int, page_end: int) -> None:
        nonlocal ordinal
        body = "".join(sentences).strip()
        if not body:
            return
        chunks.append(Chunk(
            ordinal=ordinal,
            heading_path=_heading_path(stack),
            page_start=page_start,
            page_end=page_end,
            block_type="text",
            text=body,
            token_len=estimate_tokens(body),
        ))
        ordinal += 1

    def emit_atomic(block: ParsedBlock) -> None:
        nonlocal ordinal
        if block.type == "table":
            payload = block.html or block.text
        elif block.type == "equation":
            payload = block.latex or block.text
        else:  # image
            if block.image_path:
                payload = f"![{block.caption or ''}]({block.image_path})"
            else:
                payload = block.caption or block.text or "[image]"
        parts = []
        if block.caption and block.type != "image":
            parts.append(block.caption)
        parts.append(payload)
        body = "\n".join(parts).strip()
        if not body:
            return
        chunks.append(Chunk(
            ordinal=ordinal,
            heading_path=_heading_path(stack),
            page_start=block.page,
            page_end=block.page,
            block_type=block.type,
            text=body,
            token_len=estimate_tokens(body),
        ))
        ordinal += 1

        # 画像に OCR テキストがあれば image_ocr chunk も生成
        if block.type == "image" and block.ocr_text and block.ocr_text.strip():
            body = block.ocr_text.strip()
            if block.image_path:
                body = f"[image: {block.image_path}]\n{body}"
            chunks.append(Chunk(
                ordinal=ordinal,
                heading_path=_heading_path(stack),
                page_start=block.page,
                page_end=block.page,
                block_type="image_ocr",
                text=body,
                token_len=estimate_tokens(body),
            ))
            ordinal += 1

    for block in blocks:
        if block.type == "title":
            flush_text()
            lvl = block.level or 1
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            stack.append((lvl, block.text))
        elif block.type in ("table", "equation", "image"):
            flush_text()
            emit_atomic(block)
        else:  # text
            if block.text.strip():
                buf.append(block.text)
                buf_pages.append(block.page)
    flush_text()
    return chunks
