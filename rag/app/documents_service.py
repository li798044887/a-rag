"""文書チャンクの選択ロジック（窓掛け・上限）。DB I/O は含まない純関数。"""

from pathlib import Path

MAX_CHUNKS = 40
WINDOW = 2


def select_chunks(chunks, *, around_ordinal, window=WINDOW, max_chunks=MAX_CHUNKS):
    """ordinal 昇順前提の chunks から、窓掛け（around 指定時）と上限を適用して返す。"""
    if around_ordinal is not None:
        lo, hi = around_ordinal - window, around_ordinal + window
        chunks = [c for c in chunks if lo <= c.ordinal <= hi]
    return chunks[:max_chunks]


def assets_dir_for(raw_path: str) -> str:
    """原本パスから、抽出画像を置く安定ディレクトリを決定的に導出する。"""
    return str(Path(raw_path).with_suffix("")) + "_assets"


def resolve_within(base: str, rel: str) -> Path | None:
    """base 配下に解決される実パスを返す。base の外へ出る場合は None（トラバーサル防御）。"""
    base_p = Path(base).resolve()
    target = (base_p / rel).resolve()
    try:
        target.relative_to(base_p)
    except ValueError:
        return None
    return target
