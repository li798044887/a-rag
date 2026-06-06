import math
import re
import unicodedata

_SPACE = re.compile(r"\s+")


def normalize_text(s: str) -> str:
    """全角→半角（NFKC）、空白圧縮、小文字化。決定的・LLM 不要。"""
    s = unicodedata.normalize("NFKC", s)
    s = _SPACE.sub(" ", s)
    return s.strip().lower()


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 1.0
    top = set(ranked[:k])
    return len(top & relevant) / len(relevant)


def precision_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if k <= 0:
        return 0.0
    top = ranked[:k]
    if not top:
        return 0.0
    hits = sum(1 for d in set(top) if d in relevant)
    return hits / k


def mrr(ranked: list[str], relevant: set[str]) -> float:
    for i, d in enumerate(ranked, start=1):
        if d in relevant:
            return 1.0 / i
    return 0.0


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 1.0
    dcg = 0.0
    for i, d in enumerate(ranked[:k], start=1):
        if d in relevant:
            dcg += 1.0 / math.log2(i + 1)
    ideal_hits = min(len(relevant), k)
    idcg = sum(1.0 / math.log2(i + 1) for i in range(1, ideal_hits + 1))
    return dcg / idcg if idcg else 0.0


def fact_coverage(normalized_corpus: str, facts: list[list[str]]) -> float:
    """facts は alias 群のリスト。各 fact は alias のいずれかが corpus に部分一致で充足。
    corpus は normalize_text 済みを渡す。alias は内部で正規化する。"""
    if not facts:
        return 1.0
    covered = 0
    for aliases in facts:
        if any(normalize_text(a) in normalized_corpus for a in aliases):
            covered += 1
    return covered / len(facts)
