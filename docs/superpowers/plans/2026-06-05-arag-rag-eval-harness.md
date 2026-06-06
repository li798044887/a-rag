# RAG 品質評価ハーネス 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python 側に検索品質の回帰評価ハーネス（`rag/eval/`）を実装し、ゴールデンセット・文書レベル/事実グラウンディングのメトリクス・2層 CI・埋め込みコレクションのバージョニングフックを揃える。

**Architecture:** `rag/eval/` を独立パッケージ化。`metrics.py`（I/O なし純関数）・`dataset.py`（YAML ゴールデン + pydantic 検証）・`runner.py`（`retrieve` を注入で受ける）・`report.py`（JSON/Markdown/閾値ゲート/ベースライン差分）・`corpus.py`（実取り込み）・`__main__.py`（CLI）に責務分割。retrieve を注入式にすることで PR スモークは DB/Qdrant 非依存、実評価は docker compose でフルスタック実行する。

**Tech Stack:** Python 3.11 / pydantic / PyYAML / pytest / 既存 `app.retrieval.service` / `app.worker.run_ingest` / Qdrant / Postgres。

**Spec:** `docs/superpowers/specs/2026-06-05-arag-rag-eval-harness-design.md`

**前提:** 全コマンドは `rag/` ディレクトリ基準。テストは `uv run pytest`。共有 Postgres は host 5433（conftest が既定設定）。

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `rag/eval/__init__.py` | パッケージマーカー（空） |
| `rag/eval/dataset.py` | ゴールデンの pydantic モデル + YAML ローダ + 検証 |
| `rag/eval/metrics.py` | 純関数: `normalize_text` / `recall_at_k` / `precision_at_k` / `mrr` / `ndcg_at_k` / `fact_coverage` |
| `rag/eval/runner.py` | `retrieve` 注入式ランナー。ケース毎実行 → メトリクス集計 |
| `rag/eval/report.py` | JSON/Markdown 生成 / 閾値ゲート / ベースライン差分 |
| `rag/eval/corpus.py` | filename→document 解決 + 同期取り込み（DB/Qdrant に触る唯一の層） |
| `rag/eval/__main__.py` | CLI: `ingest` / `run` サブコマンド |
| `rag/eval/golden/agentic_rag.yaml` | デモケース母体のゴールデン |
| `rag/eval/baselines/agentic_rag.json` | メトリクス基準値（回帰検出） |
| `rag/eval/README.md` | 実行手順 |
| `rag/tests/test_eval_metrics.py` | メトリクス純関数テスト |
| `rag/tests/test_eval_dataset.py` | スキーマ/検証/正規化テスト |
| `rag/tests/test_eval_runner.py` | fake retrieve 注入のランナー結線テスト |
| `rag/tests/test_eval_report.py` | ゲート/差分/Markdown テスト |
| `rag/tests/test_qdrant_collection_name.py` | コレクション命名フックのテスト |
| `.github/workflows/rag-eval-smoke.yml` | Layer 1: 毎PR スモーク |
| `.github/workflows/rag-eval-full.yml` | Layer 2: 手動/夜間フルスタック実評価 |

---

## Task 1: 依存・パッケージ雛形・イメージ同梱（重要な制約対応）

**Files:**
- Modify: `rag/pyproject.toml`
- Modify: `rag/Dockerfile`
- Modify: `docker-compose.yml`
- Create: `rag/eval/__init__.py`

> **重要な制約（メモリ由来）:** rag はソースをマウントせず**ベイク済み Docker イメージ**で動く。
> 現 Dockerfile は `app`/`alembic` のみ COPY し `eval/` を含まない。さらにデモPDFは
> `rag/` ビルドコンテキスト外の `docs/demo-files/`（計約2MB）にあり、コンテナ内に存在しない。
> よって (1) `eval/` を Dockerfile に追加、(2) デモPDFを read-only バインドマウントで供給、
> (3) 変更後は `docker compose up -d --build rag` で再ビルドが必要。

- [ ] **Step 1: PyYAML を本番依存に追加**

`rag/pyproject.toml` の `dependencies` 末尾（`"tenacity>=9.0",` の次の行）に追加する。`eval run` はコンテナ内（本番依存のみ）で動くため dev ではなく本番側に置く。

```toml
  "tenacity>=9.0",
  "pyyaml>=6.0",
]
```

- [ ] **Step 2: 依存を同期**

Run: `uv sync`
Expected: 成功し `pyyaml` が解決される。

- [ ] **Step 3: パッケージマーカーを作成**

`rag/eval/__init__.py`:

```python
"""検索品質の回帰評価ハーネス。"""
```

- [ ] **Step 4: eval/ をイメージに同梱**

`rag/Dockerfile` の `COPY alembic.ini ./alembic.ini`（20行目付近）の直後に追加:

```dockerfile
COPY alembic.ini ./alembic.ini
COPY eval ./eval
```

- [ ] **Step 5: デモPDFを rag コンテナへ read-only マウント**

`docker-compose.yml` の `rag` サービスの `volumes` を変更する（現状 `volumes: ["uploads:/data/uploads", "modelcache:/root/.cache"]`）:

```yaml
    volumes:
      - "uploads:/data/uploads"
      - "modelcache:/root/.cache"
      - "./docs/demo-files:/data/demo-files:ro"
```

- [ ] **Step 6: コミット**

```bash
git add rag/pyproject.toml rag/uv.lock rag/eval/__init__.py rag/Dockerfile docker-compose.yml
git commit -m "chore: 評価ハーネスの eval パッケージ・pyyaml 依存・イメージ同梱/マウントを追加"
```

---

## Task 2: ゴールデンのデータモデルとローダ（`dataset.py`）

**Files:**
- Create: `rag/eval/dataset.py`
- Test: `rag/tests/test_eval_dataset.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_eval_dataset.py`:

```python
import textwrap

import pytest

from eval.dataset import GoldenSuite, load_suite


def _write(tmp_path, body: str):
    p = tmp_path / "golden.yaml"
    p.write_text(textwrap.dedent(body), encoding="utf-8")
    return p


def test_load_suite_parses_cases(tmp_path):
    path = _write(tmp_path, """
        suite: demo
        owner_user_id: __eval__
        documents:
          - a.pdf
          - b.pdf
        thresholds:
          recall_at_5: 0.8
          fact_coverage: 0.75
        cases:
          - id: c1
            query: "なに？"
            top_k: 6
            relevant_documents: [a.pdf]
            key_facts:
              - any: ["AlphaGate X2", "AlphaGate"]
      """)
    suite = load_suite(path)
    assert isinstance(suite, GoldenSuite)
    assert suite.owner_user_id == "__eval__"
    assert suite.cases[0].id == "c1"
    assert suite.cases[0].rewritten is None
    assert suite.cases[0].key_facts[0].any == ["AlphaGate X2", "AlphaGate"]
    assert suite.thresholds.recall_at_5 == 0.8


def test_relevant_documents_must_be_subset(tmp_path):
    path = _write(tmp_path, """
        suite: demo
        owner_user_id: __eval__
        documents: [a.pdf]
        cases:
          - id: c1
            query: "x"
            relevant_documents: [missing.pdf]
      """)
    with pytest.raises(ValueError, match="missing.pdf"):
        load_suite(path)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `uv run pytest tests/test_eval_dataset.py -v`
Expected: FAIL（`eval.dataset` が無い / ImportError）

- [ ] **Step 3: 最小実装を書く**

`rag/eval/dataset.py`:

```python
from pathlib import Path

import yaml
from pydantic import BaseModel, model_validator


class KeyFact(BaseModel):
    any: list[str]  # いずれか1つが top-k 本文に出現すれば充足


class Case(BaseModel):
    id: str
    query: str
    rewritten: str | None = None
    top_k: int = 6
    relevant_documents: list[str] = []
    key_facts: list[KeyFact] = []


class Thresholds(BaseModel):
    recall_at_5: float | None = None
    fact_coverage: float | None = None


class GoldenSuite(BaseModel):
    suite: str
    owner_user_id: str
    documents: list[str]
    thresholds: Thresholds = Thresholds()
    cases: list[Case]

    @model_validator(mode="after")
    def _check_relevant_subset(self) -> "GoldenSuite":
        known = set(self.documents)
        for case in self.cases:
            for fn in case.relevant_documents:
                if fn not in known:
                    raise ValueError(
                        f"case {case.id}: relevant_documents に未登録の {fn} があります")
        return self


def load_suite(path: str | Path) -> GoldenSuite:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return GoldenSuite.model_validate(data)
```

- [ ] **Step 4: テストが通ることを確認**

Run: `uv run pytest tests/test_eval_dataset.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add rag/eval/dataset.py rag/tests/test_eval_dataset.py
git commit -m "feat: ゴールデンセットの pydantic モデルと YAML ローダを追加"
```

---

## Task 3: メトリクス純関数（`metrics.py`）

**Files:**
- Create: `rag/eval/metrics.py`
- Test: `rag/tests/test_eval_metrics.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_eval_metrics.py`:

```python
from eval.metrics import (
    fact_coverage,
    mrr,
    ndcg_at_k,
    normalize_text,
    precision_at_k,
    recall_at_k,
)


def test_recall_at_k_counts_relevant_hits():
    ranked = ["a.pdf", "b.pdf", "c.pdf"]
    assert recall_at_k(ranked, {"a.pdf", "c.pdf"}, k=3) == 1.0
    assert recall_at_k(ranked, {"a.pdf", "c.pdf"}, k=2) == 0.5
    assert recall_at_k(ranked, {"z.pdf"}, k=3) == 0.0
    assert recall_at_k([], {"a.pdf"}, k=5) == 0.0


def test_precision_at_k():
    ranked = ["a.pdf", "x.pdf", "b.pdf"]
    assert precision_at_k(ranked, {"a.pdf", "b.pdf"}, k=2) == 0.5


def test_mrr_uses_first_relevant_rank():
    assert mrr(["x.pdf", "a.pdf"], {"a.pdf"}) == 0.5
    assert mrr(["a.pdf"], {"a.pdf"}) == 1.0
    assert mrr(["x.pdf"], {"a.pdf"}) == 0.0


def test_ndcg_at_k_perfect_and_partial():
    assert ndcg_at_k(["a.pdf", "b.pdf"], {"a.pdf", "b.pdf"}, k=2) == 1.0
    # 1件正解が2位のみ: DCG=1/log2(3), IDCG=1/log2(2)=1
    import math
    expected = (1 / math.log2(3)) / 1.0
    assert abs(ndcg_at_k(["x.pdf", "a.pdf"], {"a.pdf"}, k=2) - expected) < 1e-9


def test_normalize_text_folds_width_and_space_and_case():
    assert normalize_text("ＡＢ　９２万円  X") == "ab 92万円 x"


def test_fact_coverage_substring_after_normalize():
    corpus = normalize_text("採用候補は AlphaGate X2。初年度費用 92万円。")
    facts = [["alphagate x2"], ["920000", "92万円"], ["存在しない"]]
    assert fact_coverage(corpus, facts) == 2 / 3
    assert fact_coverage(corpus, []) == 1.0
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `uv run pytest tests/test_eval_metrics.py -v`
Expected: FAIL（ImportError）

- [ ] **Step 3: 最小実装を書く**

`rag/eval/metrics.py`:

```python
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `uv run pytest tests/test_eval_metrics.py -v`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add rag/eval/metrics.py rag/tests/test_eval_metrics.py
git commit -m "feat: 検索メトリクスと事実グラウンディングの純関数を追加"
```

---

## Task 4: 評価ランナー（`runner.py`）

**Files:**
- Create: `rag/eval/runner.py`
- Test: `rag/tests/test_eval_runner.py`

ランナーは `retrieve_fn(query, owner, top_k) -> Sequence[item]` を注入で受ける。item は `document_title` / `text` / `expanded_text` 属性を持てばよい（本番は `RetrievedChunk`、テストは fake）。

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_eval_runner.py`:

```python
from dataclasses import dataclass

from eval.dataset import GoldenSuite
from eval.runner import run_suite


@dataclass
class FakeChunk:
    document_title: str
    text: str = ""
    expanded_text: str = ""


def _suite() -> GoldenSuite:
    return GoldenSuite.model_validate({
        "suite": "t",
        "owner_user_id": "__eval__",
        "documents": ["a.pdf", "b.pdf"],
        "cases": [{
            "id": "c1",
            "query": "q",
            "top_k": 5,
            "relevant_documents": ["a.pdf"],
            "key_facts": [{"any": ["AlphaGate X2"]}],
        }],
    })


def test_run_suite_computes_case_and_aggregate():
    def fake_retrieve(query, owner, top_k):
        assert owner == "__eval__"
        assert top_k == 5
        return [FakeChunk("a.pdf", expanded_text="採用候補は AlphaGate X2。"),
                FakeChunk("b.pdf")]

    result = run_suite(_suite(), fake_retrieve)
    case = result["cases"][0]
    assert case["id"] == "c1"
    assert case["recall_at_5"] == 1.0
    assert case["fact_coverage"] == 1.0
    assert case["n_retrieved"] == 2
    assert result["aggregate"]["recall_at_5"] == 1.0
    assert result["aggregate"]["fact_coverage"] == 1.0


def test_run_suite_miss_lowers_metrics():
    def fake_retrieve(query, owner, top_k):
        return [FakeChunk("b.pdf", expanded_text="無関係")]

    result = run_suite(_suite(), fake_retrieve)
    case = result["cases"][0]
    assert case["recall_at_5"] == 0.0
    assert case["fact_coverage"] == 0.0
    assert case["mrr"] == 0.0
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `uv run pytest tests/test_eval_runner.py -v`
Expected: FAIL（ImportError）

- [ ] **Step 3: 最小実装を書く**

`rag/eval/runner.py`:

```python
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `uv run pytest tests/test_eval_runner.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add rag/eval/runner.py rag/tests/test_eval_runner.py
git commit -m "feat: ゴールデン評価ランナー（retrieve 注入式）を追加"
```

---

## Task 5: レポートとゲート（`report.py`）

**Files:**
- Create: `rag/eval/report.py`
- Test: `rag/tests/test_eval_report.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_eval_report.py`:

```python
from eval.dataset import Thresholds
from eval.report import diff_baseline, gate_failures, to_markdown


def _result():
    return {
        "suite": "t",
        "cases": [{"id": "c1", "n_retrieved": 2, "recall_at_5": 1.0,
                   "recall_at_k": 1.0, "precision_at_k": 0.5, "mrr": 1.0,
                   "ndcg_at_k": 1.0, "fact_coverage": 0.5}],
        "aggregate": {"recall_at_5": 1.0, "recall_at_k": 1.0, "precision_at_k": 0.5,
                      "mrr": 1.0, "ndcg_at_k": 1.0, "fact_coverage": 0.5},
    }


def test_gate_failures_reports_below_threshold():
    th = Thresholds(recall_at_5=0.8, fact_coverage=0.75)
    failures = gate_failures(_result(), th)
    assert len(failures) == 1
    assert "fact_coverage" in failures[0]


def test_gate_failures_empty_when_passing():
    th = Thresholds(recall_at_5=0.8, fact_coverage=0.4)
    assert gate_failures(_result(), th) == []


def test_diff_baseline_computes_deltas():
    baseline = {"aggregate": {"recall_at_5": 0.8, "fact_coverage": 0.6}}
    deltas = diff_baseline(_result(), baseline)
    assert abs(deltas["recall_at_5"] - 0.2) < 1e-9
    assert abs(deltas["fact_coverage"] - (-0.1)) < 1e-9


def test_to_markdown_contains_case_and_aggregate():
    md = to_markdown(_result())
    assert "c1" in md
    assert "recall_at_5" in md
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `uv run pytest tests/test_eval_report.py -v`
Expected: FAIL（ImportError）

- [ ] **Step 3: 最小実装を書く**

`rag/eval/report.py`:

```python
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `uv run pytest tests/test_eval_report.py -v`
Expected: PASS（4 件）

- [ ] **Step 5: コミット**

```bash
git add rag/eval/report.py rag/tests/test_eval_report.py
git commit -m "feat: 評価レポート生成・閾値ゲート・ベースライン差分を追加"
```

---

## Task 6: 埋め込みコレクションのバージョニングフック（条件3）

**Files:**
- Modify: `rag/app/config.py`
- Modify: `rag/app/vectorstore/qdrant.py:11-13`
- Test: `rag/tests/test_qdrant_collection_name.py`

現状ハードコードの `arag_chunks` を、モデル識別子付き既定名 `arag_chunks__{embedder}` に切り出す。明示指定（既存テスト）は不変。

> **注意（実装者向け）:** これにより本番の既定コレクション名が `arag_chunks` → `arag_chunks__bge-m3` に変わる。既存の索引データは孤立するため、適用後は CLAUDE.md「横断共有への移行リセット」に準じて Qdrant を作り直し再インデックスすること（条件3のブルーグリーン方針そのもの）。

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_qdrant_collection_name.py`:

```python
from app.config import settings
from app.vectorstore.qdrant import QdrantStore, default_collection_name


def test_default_collection_name_includes_embedder():
    assert default_collection_name() == f"arag_chunks__{settings.embedder}"


def test_store_uses_versioned_default_collection():
    store = QdrantStore(dim=8)
    assert store.collection == f"arag_chunks__{settings.embedder}"


def test_explicit_collection_overrides_default():
    store = QdrantStore(collection="explicit_x", dim=8)
    assert store.collection == "explicit_x"
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `uv run pytest tests/test_qdrant_collection_name.py -v`
Expected: FAIL（`default_collection_name` 未定義 / 既定が `arag_chunks`）

- [ ] **Step 3: config に設定を追加**

`rag/app/config.py` の `Settings` に追加（`upload_dir` の次の行）:

```python
    upload_dir: str = "/data/uploads"
    # 空なら embedder からコレクション名を導出（バージョニング: モデル毎に別コレクション）。
    qdrant_collection: str = ""
```

- [ ] **Step 4: QdrantStore の既定をバージョン名に切替**

`rag/app/vectorstore/qdrant.py` の import 群直下に追加し、`__init__` を修正する。

import 群の直後（`SPARSE = "lexical"` の下）に追加:

```python
def default_collection_name() -> str:
    return settings.qdrant_collection or f"arag_chunks__{settings.embedder}"
```

`__init__` を次に置換:

```python
    def __init__(self, collection: str | None = None, dim: int = 1024):
        self.collection = collection or default_collection_name()
        self.dim = dim
        self.client = QdrantClient(url=settings.qdrant_url, timeout=30)
```

- [ ] **Step 5: テストが通ることを確認**

Run: `uv run pytest tests/test_qdrant_collection_name.py -v`
Expected: PASS（3 件）

- [ ] **Step 6: 既存の Qdrant 系テストが壊れていないことを確認**

Run: `uv run pytest tests/test_qdrant_store.py tests/test_qdrant_content_filter.py -v`
Expected: PASS（明示コレクション名を使うため影響なし。Qdrant 稼働が前提）

- [ ] **Step 7: コミット**

```bash
git add rag/app/config.py rag/app/vectorstore/qdrant.py rag/tests/test_qdrant_collection_name.py
git commit -m "feat: Qdrant コレクション名を埋め込みモデル別に導出（バージョニング基盤）"
```

---

## Task 7: 同期取り込みと filename 解決（`corpus.py`）

**Files:**
- Create: `rag/eval/corpus.py`
- Test: `rag/tests/test_eval_corpus.py`

DB/Qdrant に触る唯一の層。`resolve` は未取り込みを欠落として報告。`ingest_files` は既存アップロードと同じ行（Content/Document/IngestJob）を作り `worker.run_ingest` を同期実行。

> **注意:** `ingest_files` の統合テストはフルスタック（Postgres + Qdrant + 実 parse）前提のため Layer 2 扱い。本タスクの自動テストは `resolve` の DB 部分のみを共有 Postgres（5433）で検証する。メモリの「rag tests は共有DBを使う」に従い owner は uuid で隔離し後始末する。

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_eval_corpus.py`:

```python
import uuid

import pytest

from app.db import SessionLocal
from app.models import Content, Document
from eval.corpus import MissingDocumentsError, resolve


def test_resolve_maps_filenames_and_reports_missing():
    session = SessionLocal()
    owner = "evalcorpus_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    try:
        session.add(Content(content_hash=h, mime="application/pdf", size=1,
                            raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
        session.flush()
        session.add(Document(owner_user_id=owner, content_hash=h, filename="a.pdf"))
        session.commit()

        mapping = resolve(session, owner, ["a.pdf"])
        assert mapping["a.pdf"][1] == h

        with pytest.raises(MissingDocumentsError, match="b.pdf"):
            resolve(session, owner, ["a.pdf", "b.pdf"])
    finally:
        session.query(Document).filter_by(owner_user_id=owner).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `uv run pytest tests/test_eval_corpus.py -v`
Expected: FAIL（ImportError）

- [ ] **Step 3: 最小実装を書く**

`rag/eval/corpus.py`:

```python
import hashlib
from pathlib import Path

from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.models import Content, Document, IngestJob
from app.parsing.dispatch import parse_document
from app.vectorstore.qdrant import QdrantStore
from app.worker import run_ingest


class MissingDocumentsError(RuntimeError):
    pass


def resolve(session: Session, owner: str,
            filenames: list[str]) -> dict[str, tuple[str, str]]:
    """filename -> (document_id, content_hash)。未取り込みは MissingDocumentsError。"""
    rows = (session.query(Document.filename, Document.id, Document.content_hash)
            .filter(Document.owner_user_id == owner,
                    Document.filename.in_(filenames))
            .all())
    mapping = {fn: (did, ch) for fn, did, ch in rows}
    missing = [fn for fn in filenames if fn not in mapping]
    if missing:
        raise MissingDocumentsError(
            "未取り込みの文書があります: " + ", ".join(missing)
            + "  先に `python -m eval ingest` を実行してください。")
    return mapping


def ingest_files(session: Session, store: QdrantStore, embedder: Embedder,
                 owner: str, files_dir: str | Path, filenames: list[str]) -> None:
    """原本を owner で取り込む。既存 content/document は冪等スキップ。実 parse を同期実行。"""
    files_dir = Path(files_dir)
    for filename in filenames:
        path = files_dir / filename
        data = path.read_bytes()
        content_hash = hashlib.sha256(data).hexdigest()

        content = session.get(Content, content_hash)
        if content is None:
            # eval は原本（docs/demo-files/）を直接 raw_path に指す。run_ingest が
            # content.raw_path を parse 入力に使うため、解析時にアクセス可能であること。
            content = Content(content_hash=content_hash, mime="application/pdf",
                              size=len(data), raw_path=str(path),
                              status="queued", ref_count=0)
            session.add(content)
            session.flush()

        doc = (session.query(Document)
               .filter_by(owner_user_id=owner, content_hash=content_hash)
               .one_or_none())
        if doc is None:
            session.add(Document(owner_user_id=owner, content_hash=content_hash,
                                 filename=filename))
            content.ref_count = content.ref_count + 1

        if content.status != "ready":
            job = IngestJob(content_hash=content_hash, status="queued")
            session.add(job)
            session.flush()
            run_ingest(session, store, embedder, parse_document, content_hash, job.id)
        session.commit()
```

> **実装者注:** `run_ingest` は `content.raw_path` を MinerU/テキスト parse の入力に使う。eval は原本を複製せず `docs/demo-files/<filename>` を直接 `raw_path` に指すため、解析実行時にそのパスがコンテナから見えること（リポジトリがマウントされた docker compose 実行を前提とする）。

- [ ] **Step 4: テストが通ることを確認**

Run: `uv run pytest tests/test_eval_corpus.py -v`
Expected: PASS（1 件、Postgres 5433 稼働が前提）

- [ ] **Step 5: コミット**

```bash
git add rag/eval/corpus.py rag/tests/test_eval_corpus.py
git commit -m "feat: 評価用の filename 解決と同期取り込みを追加"
```

---

## Task 8: CLI（`__main__.py`）

**Files:**
- Create: `rag/eval/__main__.py`

retrieve を本番サービスへ束ねる薄いラッパ。CLI は `ingest` と `run` を提供。自動テストは付けず（フルスタック前提）、手動スモークで確認。

- [ ] **Step 1: CLI を実装**

`rag/eval/__main__.py`:

```python
import argparse
import json
import sys
from pathlib import Path

from app.db import SessionLocal
from app.embedding.factory import get_embedder
from app.reranker.factory import get_reranker
from app.retrieval.service import retrieve as retrieve_service
from app.vectorstore.qdrant import QdrantStore
from eval.corpus import ingest_files, resolve
from eval.dataset import load_suite
from eval.report import diff_baseline, gate_failures, to_markdown
from eval.runner import run_suite

EVAL_DIR = Path(__file__).parent
DEFAULT_GOLDEN = EVAL_DIR / "golden" / "agentic_rag.yaml"
# コンテナ内では docker-compose の read-only マウント先。ローカル直実行時は --files-dir で上書き。
DEMO_DIR = Path("/data/demo-files")


def _cmd_ingest(args) -> int:
    suite = load_suite(args.golden)
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=embedder.dim)
        store.ensure_collection()
        ingest_files(session, store, embedder, suite.owner_user_id,
                     args.files_dir, suite.documents)
    finally:
        session.close()
    print(f"取り込み完了: {len(suite.documents)} 文書 / owner={suite.owner_user_id}")
    return 0


def _cmd_run(args) -> int:
    suite = load_suite(args.golden)
    session = SessionLocal()
    try:
        embedder = get_embedder()
        reranker = get_reranker()
        store = QdrantStore(dim=embedder.dim)
        resolve(session, suite.owner_user_id, suite.documents)  # 取り込み済み検証

        def retrieve_fn(query: str, owner: str, top_k: int):
            return retrieve_service(session, store, embedder, reranker,
                                    query=query, owner_user_id=owner, top_k=top_k)

        result = run_suite(suite, retrieve_fn)
    finally:
        session.close()

    print(to_markdown(result))
    if args.out:
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
    if args.baseline and Path(args.baseline).exists():
        baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
        print("\n## ベースライン差分")
        for k, d in diff_baseline(result, baseline).items():
            print(f"- {k}: {d:+.3f}")
    if args.gate:
        failures = gate_failures(result, suite.thresholds)
        if failures:
            print("\nゲート失敗:", file=sys.stderr)
            for f in failures:
                print(" -", f, file=sys.stderr)
            return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="eval")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ing = sub.add_parser("ingest", help="ゴールデン文書を取り込む")
    p_ing.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    p_ing.add_argument("--files-dir", default=str(DEMO_DIR))
    p_ing.set_defaults(func=_cmd_ingest)

    p_run = sub.add_parser("run", help="評価を実行")
    p_run.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    p_run.add_argument("--out", default=None, help="レポート JSON 出力先")
    p_run.add_argument("--baseline", default=None, help="ベースライン JSON")
    p_run.add_argument("--gate", action="store_true", help="閾値未達で非ゼロ終了")
    p_run.set_defaults(func=_cmd_run)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: CLI のスモーク（引数パースのみ・モデル不要）**

Run: `uv run python -m eval --help && uv run python -m eval run --help`
Expected: usage が表示され終了コード 0。

- [ ] **Step 3: コミット**

```bash
git add rag/eval/__main__.py
git commit -m "feat: 評価ハーネスの CLI（ingest/run）を追加"
```

---

## Task 9: ゴールデンセットとベースラインを構築

**Files:**
- Create: `rag/eval/golden/agentic_rag.yaml`
- Create: `rag/eval/baselines/agentic_rag.json`
- Create: `rag/eval/README.md`

`docs/demo-files/AGENTIC_RAG_DEMO_CASES.md` の8ケースから、文書レベル正解（対象PDF）と key_facts（期待回答の要点の固有名・数値・日付）を抽出する。

- [ ] **Step 1: ゴールデン YAML を作成**

`rag/eval/golden/agentic_rag.yaml`:

```yaml
suite: agentic_rag_demo
owner_user_id: __eval__
documents:
  - 04-cross-page-table-semantic-loss.pdf
  - 05-image-grounding-cooling-line.pdf
  - 06-multi-file-requirement-request.pdf
  - 07-multi-file-security-policy.pdf
  - 08-multi-file-vendor-quotes.pdf
  - 09-query-rewrite-acronym-runbook.pdf
  - 10-exception-latest-rule-conflict.pdf
thresholds:
  recall_at_5: 0.80
  fact_coverage: 0.70
cases:
  - id: case1-cross-page-table
    query: "MX-17は即時停止すべき？点検表の計測値、注記コード、本文の例外条件を分けて説明して"
    top_k: 6
    relevant_documents:
      - 04-cross-page-table-semantic-loss.pdf
    key_facts:
      - any: ["N9"]
      - any: ["翌営業日AM", "翌営業日"]
      - any: ["0.91"]
  - id: case2-image-grounding
    query: "T2温度上昇とF1流量低下が同時に出た場合、図面上どの部品を第一候補で点検すべき？"
    top_k: 6
    relevant_documents:
      - 05-image-grounding-cooling-line.pdf
    key_facts:
      - any: ["V-12", "Ｖ-12"]
      - any: ["バイパス弁"]
      - any: ["HX-7"]
  - id: case3-edge-gateway-select
    query: "エッジAIゲートウェイを1つ選ぶならどれ？要求仕様・規程・見積を照合して不採用理由も"
    top_k: 6
    relevant_documents:
      - 06-multi-file-requirement-request.pdf
      - 07-multi-file-security-policy.pdf
      - 08-multi-file-vendor-quotes.pdf
    key_facts:
      - any: ["AlphaGate X2", "AlphaGate"]
      - any: ["2026-06-05"]
      - any: ["BetaEdge Mini", "BetaEdge"]
  - id: case4-query-rewrite-acronym
    query: "RED routeでP2 chatterが出ている。何を確認し、暫定対応と恒久対応は？"
    top_k: 6
    relevant_documents:
      - 09-query-rewrite-acronym-runbook.pdf
    key_facts:
      - any: ["Kafka consumer lag", "consumer lag"]
      - any: ["dedupe window", "180秒"]
      - any: ["idempotency key", "idempotency"]
  - id: case5-exception-latest-rule
    query: "2026-05-25にカスタマーサクセス部が低リスク顧客へAI回答する場合、部長承認・レビュー・保存期間は？"
    top_k: 6
    relevant_documents:
      - 10-exception-latest-rule-conflict.pdf
    key_facts:
      - any: ["EX-44"]
      - any: ["部長承認", "承認"]
      - any: ["180日"]
  - id: case6-negative-reason
    query: "GammaVision Cloudを採用できない理由を要求仕様とセキュリティ規程の両方から説明して"
    top_k: 6
    relevant_documents:
      - 06-multi-file-requirement-request.pdf
      - 07-multi-file-security-policy.pdf
      - 08-multi-file-vendor-quotes.pdf
    key_facts:
      - any: ["ローカル推論", "ローカル"]
      - any: ["海外リージョン", "海外"]
      - any: ["90日"]
```

- [ ] **Step 2: ゴールデンがスキーマ検証を通ることを確認**

Run: `uv run python -c "from eval.dataset import load_suite; s=load_suite('eval/golden/agentic_rag.yaml'); print(len(s.cases), 'cases ok')"`
Expected: `6 cases ok`

- [ ] **Step 3: README を作成**

`rag/eval/README.md`:

```markdown
# RAG 検索品質 評価ハーネス

検索品質を文書レベル recall@k / 事実グラウンディング(fact_coverage)で回帰評価する。

## 構成
- `golden/agentic_rag.yaml` … ゴールデンセット（質問・正解文書・期待事実）
- `metrics.py` … 純関数メトリクス / `runner.py` … 実行 / `report.py` … レポート・ゲート
- `corpus.py` … 取り込み・解決 / `__main__.py` … CLI

## ローカル実行（フルスタック必須）
rag はベイク済みイメージのため、eval コード変更後は必ず `--build` で再ビルドする。
デモPDFは compose の read-only マウント（`/data/demo-files`）から読む。
```bash
docker compose --profile worker up -d --build rag
docker compose exec -T rag uv run python -m eval ingest
docker compose exec -T rag uv run python -m eval run \
  --gate --baseline eval/baselines/agentic_rag.json --out eval-report.json
```

## ベースライン更新
意図的に基準を更新する時のみ `--out` の結果を `baselines/agentic_rag.json` にコピーしてコミットする。

## 埋め込みモデル更新（ブルーグリーン）
1. 新モデルを設定 → コレクション名 `arag_chunks__<model>` が自動で変わる
2. 全チャンクを新コレクションへ再埋め込み
3. `eval run --gate` を新コレクションで実行し品質ゲート通過を確認
4. 通過時のみサーブ切替、旧コレクション drop（未通過ならロールバック）
```

- [ ] **Step 4: 仮ベースラインを作成**

実評価未実施のため、回帰の土台として暫定値を置く（初回フルスタック実行後に実測へ差し替える）。

`rag/eval/baselines/agentic_rag.json`:

```json
{
  "suite": "agentic_rag_demo",
  "note": "暫定値。初回フルスタック実評価後に実測へ差し替えること。",
  "aggregate": {
    "recall_at_5": 0.80,
    "recall_at_k": 0.80,
    "precision_at_k": 0.30,
    "mrr": 0.80,
    "ndcg_at_k": 0.80,
    "fact_coverage": 0.70
  }
}
```

- [ ] **Step 5: コミット**

```bash
git add rag/eval/golden/agentic_rag.yaml rag/eval/baselines/agentic_rag.json rag/eval/README.md
git commit -m "feat: agentic_rag ゴールデンセット・暫定ベースライン・README を追加"
```

---

## Task 10: CI ワークフロー（2層）

**Files:**
- Create: `.github/workflows/rag-eval-smoke.yml`
- Create: `.github/workflows/rag-eval-full.yml`

- [ ] **Step 1: Layer 1 スモークワークフローを作成**

`.github/workflows/rag-eval-smoke.yml`:

```yaml
name: rag-eval-smoke

on:
  pull_request:
    paths:
      - "rag/eval/**"
      - "rag/app/vectorstore/**"
      - ".github/workflows/rag-eval-smoke.yml"

jobs:
  smoke:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: rag
    steps:
      - uses: actions/checkout@v4
      - name: Install uv
        uses: astral-sh/setup-uv@v5
      - name: Sync deps
        run: uv sync
      - name: Run harness unit tests (no models / no services)
        # --noconftest: autouse fixture 経由の app/DB import を避け、純粋に eval/* のみ検証する。
        run: >
          uv run pytest --noconftest
          tests/test_eval_metrics.py
          tests/test_eval_dataset.py
          tests/test_eval_runner.py
          tests/test_eval_report.py
          -v
```

- [ ] **Step 2: Layer 2 フルスタックワークフローを作成**

`.github/workflows/rag-eval-full.yml`:

```yaml
name: rag-eval-full

# 既定オフ。手動 or 夜間のみ（実 BGE-M3 + Qdrant + HF キャッシュが必要なため
# GitHub-hosted では原則セルフホストランナー前提）。
on:
  workflow_dispatch:
  schedule:
    - cron: "0 18 * * *"  # 03:00 JST

jobs:
  full-eval:
    runs-on: [self-hosted, rag]
    steps:
      - uses: actions/checkout@v4
      - name: Bring up full stack (rebuild rag to bake eval/)
        run: docker compose --profile worker up -d --build rag
      - name: Ingest golden documents
        run: docker compose exec -T rag uv run python -m eval ingest
      - name: Run evaluation with gate
        run: >
          docker compose exec -T rag uv run python -m eval run
          --gate --baseline eval/baselines/agentic_rag.json --out eval-report.json
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-report
          path: rag/eval-report.json
```

- [ ] **Step 3: YAML 妥当性を確認**

Run: `uv run python -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('../.github/workflows/rag-eval-*.yml')]; print('workflows ok')"`
Expected: `workflows ok`

- [ ] **Step 4: コミット**

```bash
git add .github/workflows/rag-eval-smoke.yml .github/workflows/rag-eval-full.yml
git commit -m "ci: RAG 評価ハーネスの2層ワークフロー（スモーク/フルスタック）を追加"
```

---

## Task 11: 全体検証

- [ ] **Step 1: ハーネス単体テスト一式（モデル/サービス不要分）**

Run: `uv run pytest --noconftest tests/test_eval_metrics.py tests/test_eval_dataset.py tests/test_eval_runner.py tests/test_eval_report.py -v`
Expected: 全 PASS

- [ ] **Step 2: コレクション命名テスト**

Run: `uv run pytest tests/test_qdrant_collection_name.py -v`
Expected: 全 PASS

- [ ] **Step 3: lint（既存方針に従う）**

Run: `uv run ruff check eval` （ruff 未導入ならスキップ）
Expected: エラーなし

- [ ] **Step 4: フルスタック実評価（手動・任意）**

Run:
```bash
docker compose --profile worker up -d --build rag
docker compose exec -T rag uv run python -m eval ingest
docker compose exec -T rag uv run python -m eval run --out eval-report.json
```
Expected: ケース別テーブルと集計が出力される。実測値を確認し、必要なら `baselines/agentic_rag.json` を実測へ更新してコミット（`feat: ベースラインを実測値で更新`）。

---

## 受け入れ条件カバレッジ

| Issue 条件 | 達成タスク |
| --- | --- |
| ゴールデンセット + 検索/回答品質メトリクス | Task 2,3,4,9（recall@k/precision@k/MRR/nDCG + fact_coverage。faithfulness は spec の方針 + fact_coverage プロキシ） |
| CI で回帰評価を実行 | Task 5,10（閾値ゲート + ベースライン差分 + 2層ワークフロー） |
| 埋め込み更新時の再インデックス/バージョニング | Task 6,9（コレクション命名フック + README のブルーグリーン方針） |
