from typing import Any

from eval.dataset import Thresholds


def gate_failures(result: dict[str, Any], thresholds: Thresholds) -> list[str]:
    agg = result["aggregate"]
    failures: list[str] = []
    checks = {"recall_at_5": thresholds.recall_at_5,
              "fact_coverage": thresholds.fact_coverage}
    for key, minimum in checks.items():
        if minimum is None:
            continue
        actual = agg.get(key, 0.0)
        if actual < minimum:
            failures.append(
                f"{key}: {actual:.3f} < 閾値 {minimum:.3f}")
    return failures


def diff_baseline(result: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float]:
    cur = result["aggregate"]
    base = baseline.get("aggregate", {})
    return {k: cur[k] - base[k] for k in cur if k in base}


def to_markdown(result: dict[str, Any]) -> str:
    lines = [f"# Eval Report: {result['suite']}", "", "## ケース別", "",
             "| id | recall@5 | recall@k | prec@k | mrr | ndcg@k | facts | n |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for c in result["cases"]:
        lines.append(
            f"| {c['id']} | {c['recall_at_5']:.2f} | {c['recall_at_k']:.2f} | "
            f"{c['precision_at_k']:.2f} | {c['mrr']:.2f} | {c['ndcg_at_k']:.2f} | "
            f"{c['fact_coverage']:.2f} | {c['n_retrieved']} |")
    agg = result["aggregate"]
    lines += ["", "## 集計（平均）", ""]
    for k, v in agg.items():
        lines.append(f"- {k}: {v:.3f}")
    return "\n".join(lines)
