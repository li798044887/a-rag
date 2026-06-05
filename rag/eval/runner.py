from collections.abc import Callable, Sequence
from typing import Any, Protocol

from eval.dataset import GoldenSuite
from eval.metrics import (
    fact_coverage,
    mrr,
    ndcg_at_k,
    normalize_text,
    precision_at_k,
    recall_at_k,
)


class RetrievedItem(Protocol):
    document_title: str
    text: str
    expanded_text: str


RetrieveFn = Callable[[str, str, int], Sequence[RetrievedItem]]


def _ranked_titles(items: Sequence[RetrievedItem]) -> list[str]:
    # チャンク列を所属文書のタイトル順位列へ畳む（重複は初出順位を保持）。
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        t = it.document_title
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def run_suite(suite: GoldenSuite, retrieve_fn: RetrieveFn) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    for case in suite.cases:
        query = case.rewritten or case.query
        items = list(retrieve_fn(query, suite.owner_user_id, case.top_k))
        ranked = _ranked_titles(items)
        relevant = set(case.relevant_documents)
        corpus = normalize_text(
            "\n".join((it.expanded_text or it.text or "") for it in items))
        facts = [kf.any for kf in case.key_facts]
        cases.append({
            "id": case.id,
            "n_retrieved": len(items),
            "recall_at_5": recall_at_k(ranked, relevant, 5),
            "recall_at_k": recall_at_k(ranked, relevant, case.top_k),
            "precision_at_k": precision_at_k(ranked, relevant, case.top_k),
            "mrr": mrr(ranked, relevant),
            "ndcg_at_k": ndcg_at_k(ranked, relevant, case.top_k),
            "fact_coverage": fact_coverage(corpus, facts),
        })

    keys = ["recall_at_5", "recall_at_k", "precision_at_k",
            "mrr", "ndcg_at_k", "fact_coverage"]
    aggregate = {k: _mean([c[k] for c in cases]) for k in keys}
    return {"suite": suite.suite, "cases": cases, "aggregate": aggregate}
