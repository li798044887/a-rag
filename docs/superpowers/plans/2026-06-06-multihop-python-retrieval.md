# Python 決定論的多ホップ検索（テキスト PRF）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rag（Python）に LLM 不使用の決定論的テキスト PRF 多ホップ検索を実装し、評価ハーネス（rag-eval-full）が hotpot の多ホップ回収を直接測定でき、本番 `/retrieve` も opt-in で使えるようにする。

**Architecture:** 新モジュール `rag/app/retrieval/multihop.py` が既存 `retrieve`/`retrieve_stream` を2回呼ぶオーケストレータ。hop-1 上位チャンク本文を元クエリへ連結（PRF）して hop-2 を検索し、RRF で融合。`multi_hop=True` のとき無条件発火（hop-1 非空の限り）。`/retrieve`・`/retrieve/stream` に `multi_hop` フラグ、eval に `--multi-hop` を追加。

**Tech Stack:** Python / FastAPI / pytest（rag）、TypeScript / Vitest（rag-client の最小フラグ透過）。LLM/モデル不要のユニットテストは内側 `retrieve` を monkeypatch でスタブ化。

参照 spec: `docs/superpowers/specs/2026-06-06-multihop-python-retrieval-design.md`

---

## File Structure

- Create: `rag/app/retrieval/multihop.py` — `retrieve_multihop` / `retrieve_multihop_stream` / `_prf_query` / `_rrf_fuse`。
- Create: `rag/tests/test_multihop.py` — 上記のユニットテスト（monkeypatch、DB/モデル非依存）。
- Modify: `rag/app/schemas.py` — `RetrieveRequest` に `multi_hop: bool = False`。
- Modify: `rag/app/routers/retrieve.py` — `multi_hop` で multihop 版へ分岐。
- Modify: `rag/tests/test_retrieve_api.py` — 分岐テスト。
- Modify: `rag/eval/__main__.py` — `run --multi-hop` フラグ・retrieve_fn 切替・baseline 名選択。
- Modify: `rag/tests/test_eval_report.py`（または新規）— baseline 名セレクタのテスト。
- Modify: `.github/workflows/rag-eval-full.yml` — hotpot に multi-hop 比較実行を追加。
- Modify: `src/lib/agent/retrieve-client.ts` — `multiHop` を `multi_hop` として透過（最小）。
- Modify: `src/lib/agent/retrieve-client.test.ts` — 透過のテスト。

実コマンドは rag コンテナ内で実行する（pytest 等）。プレフィクス:
`docker compose exec -T rag uv run pytest <path> -q`

---

## Task 1: RRF 融合 `_rrf_fuse`

**Files:**
- Create: `rag/app/retrieval/multihop.py`
- Create: `rag/tests/test_multihop.py`

- [ ] **Step 1: Write the failing test** — `rag/tests/test_multihop.py`

```python
from app.schemas import RetrievedChunk
from app.retrieval.multihop import _rrf_fuse


def _mk(cid: str, title: str = "") -> RetrievedChunk:
    return RetrievedChunk(chunk_id=cid, document_id=f"doc-{cid}", document_title=title or cid,
                          heading_path="h", page_start=0, page_end=0, block_type="text",
                          text=cid, expanded_text=cid, score=0.5)


def test_rrf_fuse_hop2_empty_returns_hop1_topk():
    out = _rrf_fuse([_mk("a"), _mk("b"), _mk("c")], [], top_k=2)
    assert [c.chunk_id for c in out] == ["a", "b"]


def test_rrf_fuse_merges_and_dedups():
    out = _rrf_fuse([_mk("a"), _mk("b")], [_mk("b"), _mk("c")], top_k=4)
    assert sorted(c.chunk_id for c in out) == ["a", "b", "c"]


def test_rrf_fuse_bridge_quota_keeps_hop2_top():
    out = _rrf_fuse([_mk("a"), _mk("b")], [_mk("x")], top_k=2, bridge_quota=1)
    ids = [c.chunk_id for c in out]
    assert "x" in ids
    assert len(out) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: FAIL（`app.retrieval.multihop` import 不可 / `_rrf_fuse` 未定義）

- [ ] **Step 3: Write minimal implementation** — `rag/app/retrieval/multihop.py`

```python
"""決定論的テキスト PRF 多ホップ検索。

既存 retrieve/retrieve_stream をブラックボックスとして2回呼び、hop-1 上位チャンク
本文を元クエリへ連結（PRF）して hop-2 を検索、RRF で融合する。LLM 不使用。"""
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.reranker.base import Reranker
from app.retrieval.service import DEFAULT_CANDIDATE_K, retrieve, retrieve_stream
from app.schemas import RetrievedChunk
from app.vectorstore.qdrant import QdrantStore

RRF_K = 60


def _rrf_fuse(hop1: list[RetrievedChunk], hop2: list[RetrievedChunk], *,
              top_k: int, bridge_quota: int = 2) -> list[RetrievedChunk]:
    """既に各クエリでリランク済みの2リストを RRF で融合。chunk_id 重複除去。
    hop2 上位を bridge_quota 枠で予約し、橋渡しの答えがリランクで落ちるのを防ぐ。"""
    if not hop2:
        return hop1[:top_k]
    score: dict[str, float] = {}
    by_id: dict[str, RetrievedChunk] = {}

    def add(lst: list[RetrievedChunk]) -> None:
        for rank, c in enumerate(lst):
            score[c.chunk_id] = score.get(c.chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            by_id.setdefault(c.chunk_id, c)

    add(hop1)
    add(hop2)
    fused = sorted(by_id, key=lambda cid: score[cid], reverse=True)
    top = fused[:top_k]
    top_set = set(top)

    reserved: list[str] = []
    for c in hop2:
        if len(reserved) >= bridge_quota:
            break
        if c.chunk_id not in top_set:
            reserved.append(c.chunk_id)
    if not reserved:
        return [by_id[cid] for cid in top]

    kept = top[:max(0, top_k - len(reserved))]
    kept_set = set(kept)
    final_ids = kept + [cid for cid in reserved if cid not in kept_set]
    return [by_id[cid] for cid in final_ids[:top_k]]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: PASS（3 件）

- [ ] **Step 5: Commit**

```bash
git add rag/app/retrieval/multihop.py rag/tests/test_multihop.py
git commit -m "feat: RRF 融合ユニット _rrf_fuse を追加（多ホップ基盤）"
```

---

## Task 2: PRF クエリ生成 `_prf_query`

**Files:**
- Modify: `rag/app/retrieval/multihop.py`
- Modify: `rag/tests/test_multihop.py`

- [ ] **Step 1: Write the failing test** — `rag/tests/test_multihop.py` に追記

```python
from app.retrieval.multihop import _prf_query


def test_prf_query_appends_top_doc_text():
    hop1 = [_mk("a", "Brown State Fishing Lake")]
    hop1[0].text = "located in Brown County, Kansas"
    hop1[0].expanded_text = "located in Brown County, Kansas"
    q = _prf_query("人口は?", hop1)
    assert q.startswith("人口は?")
    assert "Brown County" in q
    assert "Brown State Fishing Lake" in q


def test_prf_query_empty_hop1_returns_original():
    assert _prf_query("q", []) == "q"


def test_prf_query_truncates_body():
    c = _mk("a", "T")
    c.text = c.expanded_text = "x" * 1000
    q = _prf_query("q", [c], n_docs=1, char_budget=50)
    assert q.count("x") == 50
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: FAIL（`_prf_query` 未定義）

- [ ] **Step 3: Write minimal implementation** — `rag/app/retrieval/multihop.py` の `_rrf_fuse` の前に追加

```python
def _prf_query(query: str, hop1: list[RetrievedChunk], *,
               n_docs: int = 2, char_budget: int = 200) -> str:
    """元クエリの末尾に hop1 上位 n_docs チャンクの title+heading+本文先頭を連結。
    橋渡しエンティティ（hop1 本文中の固有名）をクエリへ注入する。hop1 が空 or
    連結対象が無ければ元クエリをそのまま返す（呼び出し側で hop-2 をスキップ）。"""
    parts = [query]
    for c in hop1[:n_docs]:
        body = (c.expanded_text or c.text or "")[:char_budget]
        seg = " ".join(x for x in (c.document_title, c.heading_path, body) if x).strip()
        if seg:
            parts.append(seg)
    return " ".join(parts).strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: PASS（既存3 + 新規3）

- [ ] **Step 5: Commit**

```bash
git add rag/app/retrieval/multihop.py rag/tests/test_multihop.py
git commit -m "feat: PRF クエリ生成 _prf_query を追加"
```

---

## Task 3: オーケストレータ `retrieve_multihop`（非ストリーム）

**Files:**
- Modify: `rag/app/retrieval/multihop.py`
- Modify: `rag/tests/test_multihop.py`

- [ ] **Step 1: Write the failing test** — `rag/tests/test_multihop.py` に追記

```python
from app.retrieval import multihop as mh


def _make_fake_retrieve(calls):
    lake = _mk("lake-1", "Brown State Fishing Lake")
    lake.text = lake.expanded_text = "located in Brown County, Kansas (no population here)"
    county = _mk("county-1", "Brown County, Kansas")
    county.text = county.expanded_text = "population was 9,508"

    def fake_retrieve(session, store, embedder, reranker, *, query, owner_user_id,
                      top_k=6, candidate_k=50, document_ids=None):
        calls.append(query)
        return [county] if "Brown County" in query else [lake]
    return fake_retrieve


def test_retrieve_multihop_recovers_answer_via_hop2(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(mh, "retrieve", _make_fake_retrieve(calls))
    out = mh.retrieve_multihop(None, None, None, None,
                               query="Brown State Fishing Lake のある郡の人口は?",
                               owner_user_id="u1", top_k=6)
    titles = [c.document_title for c in out]
    assert "Brown County, Kansas" in titles
    assert len(calls) == 2  # hop-1 + hop-2


def test_retrieve_multihop_max_hops_zero_skips_hop2(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(mh, "retrieve", _make_fake_retrieve(calls))
    out = mh.retrieve_multihop(None, None, None, None, query="q",
                               owner_user_id="u1", top_k=6, max_hops=0)
    assert len(calls) == 1
    assert [c.chunk_id for c in out] == ["lake-1"]


def test_retrieve_multihop_empty_hop1_returns_empty(monkeypatch):
    def fake_retrieve(*a, **k):
        return []
    monkeypatch.setattr(mh, "retrieve", fake_retrieve)
    out = mh.retrieve_multihop(None, None, None, None, query="q",
                               owner_user_id="u1", top_k=6)
    assert out == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: FAIL（`retrieve_multihop` 未定義）

- [ ] **Step 3: Write minimal implementation** — `rag/app/retrieval/multihop.py` に追加

```python
def retrieve_multihop(session: Session, store: QdrantStore, embedder: Embedder,
                      reranker: Reranker, *, query: str, owner_user_id: str,
                      top_k: int = 6, candidate_k: int = DEFAULT_CANDIDATE_K,
                      document_ids: list[str] | None = None,
                      max_hops: int = 1) -> list[RetrievedChunk]:
    """決定論的テキスト PRF 多ホップ。multi_hop 有効時は hop-1 が非空である限り
    無条件で hop-2 を実行（設計判断: 橋渡しは hop-1 高品質ゆえ条件分岐で取りこぼす）。"""
    hop1 = retrieve(session, store, embedder, reranker, query=query,
                    owner_user_id=owner_user_id, top_k=top_k, candidate_k=candidate_k,
                    document_ids=document_ids)
    if not hop1 or max_hops <= 0:
        return hop1
    result = hop1
    current = hop1
    for _ in range(max_hops):
        prf = _prf_query(query, current)
        if prf == query:
            break
        try:
            hopn = retrieve(session, store, embedder, reranker, query=prf,
                            owner_user_id=owner_user_id, top_k=top_k, candidate_k=candidate_k,
                            document_ids=document_ids)
        except Exception:
            break
        if not hopn:
            break
        result = _rrf_fuse(result, hopn, top_k=top_k)
        current = hopn
    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add rag/app/retrieval/multihop.py rag/tests/test_multihop.py
git commit -m "feat: 多ホップオーケストレータ retrieve_multihop を追加"
```

---

## Task 4: ストリーム版 `retrieve_multihop_stream`

**Files:**
- Modify: `rag/app/retrieval/multihop.py`
- Modify: `rag/tests/test_multihop.py`

- [ ] **Step 1: Write the failing test** — `rag/tests/test_multihop.py` に追記

```python
def test_retrieve_multihop_stream_relays_and_fuses(monkeypatch):
    lake = _mk("lake-1", "Brown State Fishing Lake")
    lake.text = lake.expanded_text = "located in Brown County, Kansas"
    county = _mk("county-1", "Brown County, Kansas")
    county.text = county.expanded_text = "population was 9,508"

    def fake_stream(session, store, embedder, reranker, *, query, owner_user_id,
                    top_k=6, candidate_k=50, document_ids=None):
        yield {"stage": "embed", "status": "done", "ms": 1}
        if "Brown County" in query:
            yield {"stage": "result", "chunks": [county]}
        else:
            yield {"stage": "result", "chunks": [lake]}

    monkeypatch.setattr(mh, "retrieve_stream", fake_stream)
    evs = list(mh.retrieve_multihop_stream(None, None, None, None,
               query="Brown State Fishing Lake のある郡の人口は?",
               owner_user_id="u1", top_k=6))
    # hop-1 の embed（hop 印なし）, hop-2 の embed（hop=2）, 最終 result
    assert any(e.get("stage") == "embed" and "hop" not in e for e in evs)
    assert any(e.get("stage") == "embed" and e.get("hop") == 2 for e in evs)
    result = [e for e in evs if e.get("stage") == "result"]
    assert len(result) == 1
    titles = [c.document_title for c in result[0]["chunks"]]
    assert "Brown County, Kansas" in titles
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: FAIL（`retrieve_multihop_stream` 未定義）

- [ ] **Step 3: Write minimal implementation** — `rag/app/retrieval/multihop.py` に追加

```python
def retrieve_multihop_stream(session: Session, store: QdrantStore, embedder: Embedder,
                             reranker: Reranker, *, query: str, owner_user_id: str,
                             top_k: int = 6, candidate_k: int = DEFAULT_CANDIDATE_K,
                             document_ids: list[str] | None = None,
                             max_hops: int = 1) -> Iterator[dict]:
    """ストリーム版（深さ1）。hop-1 の stage を中継し、hop-2 の stage には hop=2 を
    付与して中継、最後に融合結果を result として emit する。"""
    hop1: list[RetrievedChunk] = []
    for ev in retrieve_stream(session, store, embedder, reranker, query=query,
                              owner_user_id=owner_user_id, top_k=top_k,
                              candidate_k=candidate_k, document_ids=document_ids):
        if ev.get("stage") == "result":
            hop1 = ev["chunks"]
        else:
            yield ev
    if not hop1 or max_hops <= 0:
        yield {"stage": "result", "chunks": hop1}
        return
    prf = _prf_query(query, hop1)
    if prf == query:
        yield {"stage": "result", "chunks": hop1}
        return
    hop2: list[RetrievedChunk] = []
    try:
        for ev in retrieve_stream(session, store, embedder, reranker, query=prf,
                                  owner_user_id=owner_user_id, top_k=top_k,
                                  candidate_k=candidate_k, document_ids=document_ids):
            if ev.get("stage") == "result":
                hop2 = ev["chunks"]
            else:
                yield {**ev, "hop": 2}
    except Exception:
        yield {"stage": "result", "chunks": hop1}
        return
    yield {"stage": "result", "chunks": _rrf_fuse(hop1, hop2, top_k=top_k)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add rag/app/retrieval/multihop.py rag/tests/test_multihop.py
git commit -m "feat: ストリーム版 retrieve_multihop_stream を追加"
```

---

## Task 5: スキーマ `multi_hop` フィールド

**Files:**
- Modify: `rag/app/schemas.py`（`RetrieveRequest`）
- Modify: `rag/tests/test_retrieve_api.py`

- [ ] **Step 1: Write the failing test** — `rag/tests/test_retrieve_api.py` に追記

```python
def test_retrieve_request_multi_hop_defaults_false():
    req = RetrieveRequest(query="x", owner_user_id="u1")
    assert req.multi_hop is False
    req2 = RetrieveRequest(query="x", owner_user_id="u1", multi_hop=True)
    assert req2.multi_hop is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_retrieve_api.py::test_retrieve_request_multi_hop_defaults_false -q`
Expected: FAIL（`multi_hop` 未定義属性）

- [ ] **Step 3: Write minimal implementation** — `rag/app/schemas.py` の `RetrieveRequest`（`document_ids` の直後）に追加

```python
    multi_hop: bool = False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_retrieve_api.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add rag/app/schemas.py rag/tests/test_retrieve_api.py
git commit -m "feat: RetrieveRequest に multi_hop フラグを追加（既定 false）"
```

---

## Task 6: ルータ分岐（`/retrieve`・`/retrieve/stream`）

**Files:**
- Modify: `rag/app/routers/retrieve.py`
- Modify: `rag/tests/test_retrieve_api.py`

- [ ] **Step 1: Write the failing test** — `rag/tests/test_retrieve_api.py` に追記

```python
def _patch_resources(monkeypatch):
    class _Dummy:
        dim = 8
        def close(self):
            pass
    monkeypatch.setattr(retrieve_router, "SessionLocal", lambda: _Dummy())
    monkeypatch.setattr(retrieve_router, "get_embedder", lambda: _Dummy())
    monkeypatch.setattr(retrieve_router, "get_reranker", lambda: None)
    monkeypatch.setattr(retrieve_router, "QdrantStore", lambda **k: _Dummy())


def test_run_retrieve_branches_on_multi_hop(monkeypatch):
    _patch_resources(monkeypatch)
    seen = {}
    monkeypatch.setattr(retrieve_router, "run_retrieve_service",
                        lambda *a, **k: seen.update(which="single") or [])
    monkeypatch.setattr(retrieve_router, "retrieve_multihop",
                        lambda *a, **k: seen.update(which="multi") or [])
    retrieve_router._run_retrieve(RetrieveRequest(query="x", owner_user_id="u1"))
    assert seen["which"] == "single"
    retrieve_router._run_retrieve(RetrieveRequest(query="x", owner_user_id="u1", multi_hop=True))
    assert seen["which"] == "multi"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_retrieve_api.py::test_run_retrieve_branches_on_multi_hop -q`
Expected: FAIL（`retrieve_multihop` 属性が router に無い / 分岐未実装）

- [ ] **Step 3: Write minimal implementation** — `rag/app/routers/retrieve.py`

import に追加（既存 import 群の末尾付近）:
```python
from app.retrieval.multihop import retrieve_multihop, retrieve_multihop_stream
```

`_run_retrieve` を分岐に変更:
```python
def _run_retrieve(req: RetrieveRequest) -> list[RetrievedChunk]:
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=getattr(embedder, "dim", 1024))
        fn = retrieve_multihop if req.multi_hop else run_retrieve_service
        return fn(
            session, store, embedder, get_reranker(),
            query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
            top_k=req.top_k, candidate_k=req.candidate_k,
            document_ids=req.document_ids)
    finally:
        session.close()
```

`_stream_ndjson` の `retrieve_stream(...)` 呼び出しを分岐に変更:
```python
        stream_fn = retrieve_multihop_stream if req.multi_hop else retrieve_stream
        for ev in stream_fn(
                session, store, embedder, get_reranker(),
                query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
                top_k=req.top_k, candidate_k=req.candidate_k,
                document_ids=req.document_ids):
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_retrieve_api.py -q`
Expected: PASS（既存 + 新規。既存 stream テストは `multi_hop` 既定 false で従来経路）

- [ ] **Step 5: Commit**

```bash
git add rag/app/routers/retrieve.py rag/tests/test_retrieve_api.py
git commit -m "feat: /retrieve・/retrieve/stream を multi_hop で分岐"
```

---

## Task 7: eval `--multi-hop` フラグ + baseline 名選択

**Files:**
- Modify: `rag/eval/__main__.py`
- Modify: `rag/tests/test_eval_report.py`

- [ ] **Step 1: Write the failing test** — `rag/tests/test_eval_report.py` に追記

```python
def test_baseline_name_selects_multihop():
    from eval.__main__ import _baseline_name, DEFAULT_BASELINE, MULTIHOP_BASELINE
    assert _baseline_name(False) == DEFAULT_BASELINE
    assert _baseline_name(True) == MULTIHOP_BASELINE
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_eval_report.py::test_baseline_name_selects_multihop -q`
Expected: FAIL（`_baseline_name` / `MULTIHOP_BASELINE` 未定義）

- [ ] **Step 3: Write minimal implementation** — `rag/eval/__main__.py`

import に追加（`from app.retrieval.service import retrieve as retrieve_service` の下）:
```python
from app.retrieval.multihop import retrieve_multihop
```

定数追加（`DEFAULT_BASELINE = "bge-m3__bge.json"` の下）:
```python
MULTIHOP_BASELINE = "bge-m3__bge__multihop.json"


def _baseline_name(multi_hop: bool) -> str:
    return MULTIHOP_BASELINE if multi_hop else DEFAULT_BASELINE
```

`_resolve_baseline` を multi-hop 対応に:
```python
def _resolve_baseline(args) -> Path | None:
    if args.baseline:
        return Path(args.baseline)
    path = _suite_dir(args.suite) / "baselines" / _baseline_name(getattr(args, "multi_hop", False))
    return path if path.exists() else None
```

`_cmd_run` の retrieve_fn 定義を分岐に:
```python
        def retrieve_fn(query: str, owner: str, top_k: int):
            if args.multi_hop:
                return retrieve_multihop(session, store, embedder, reranker,
                                         query=query, owner_user_id=owner, top_k=top_k)
            return retrieve_service(session, store, embedder, reranker,
                                    query=query, owner_user_id=owner, top_k=top_k)
```

`run` サブパーサにフラグ追加（`p_run.add_argument("--gate", ...)` の下）:
```python
    p_run.add_argument("--multi-hop", dest="multi_hop", action="store_true",
                       help="決定論的テキスト PRF 多ホップで検索する")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_eval_report.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add rag/eval/__main__.py rag/tests/test_eval_report.py
git commit -m "feat: eval run に --multi-hop と multi-hop baseline 選択を追加"
```

> 注: 実際の multi-hop baseline JSON（`rag/eval/suites/hotpot_dev/baselines/bge-m3__bge__multihop.json`）は GPU runner で `--multi-hop --out ...` を実走して生成・commit する（本 plan のローカル作業では数値を作れない）。Task 8 の CI で hotpot multi-hop を回した出力を baseline として採用する。

---

## Task 8: CI ワークフローに hotpot multi-hop 比較を追加

**Files:**
- Modify: `.github/workflows/rag-eval-full.yml`

- [ ] **Step 1: Implementation** — `.github/workflows/rag-eval-full.yml` の `Run evaluation with gate` ステップ（`exit $LASTEXITCODE` 行の直後、`Publish report summary` ステップの前）に新ステップを追加

```yaml
      - name: Run multi-hop comparison (hotpot only)
        if: startsWith(env.EVAL_SUITE, 'hotpot_')
        continue-on-error: true
        run: |
          docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec -T rag uv run python -m eval run `
            --suite $env:EVAL_SUITE `
            --golden "/data/eval-reports/$env:EVAL_SUITE/golden.yaml" `
            --multi-hop `
            --out "/data/eval-reports/$env:EVAL_SUITE/eval-report.multihop.json" `
            | Tee-Object -FilePath "artifacts/rag-eval/$env:EVAL_SUITE/eval-report.multihop.md"
```

> single-shot のゲートは従来どおり維持し、multi-hop は**情報用の比較実行**（`continue-on-error`、gate なし）。multi-hop 自体のゲート閾値・baseline commit は実測後（issue 残タスク D）。

- [ ] **Step 2: Validate YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/rag-eval-full.yml'))" && echo OK`
Expected: `OK`（パース成功。実走検証は self-hosted GPU runner 上で行う）

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/rag-eval-full.yml
git commit -m "ci: rag-eval-full に hotpot multi-hop 比較実行を追加"
```

---

## Task 9: TS rag-client の `multi_hop` 透過（最小）

**Files:**
- Modify: `src/lib/agent/retrieve-client.ts`
- Modify: `src/lib/agent/retrieve-client.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/agent/retrieve-client.test.ts` に追記

```ts
test("multiHop を渡すと body に multi_hop: true を送る", async () => {
  const calls: Array<{ body: string }> = [];
  vi.mocked(ragFetch).mockImplementation(async (_path: string, init: { body: string }) => {
    calls.push({ body: init.body });
    return new Response(JSON.stringify({ chunks: [] }), { status: 200 });
  });
  await retrieveChunks({ query: "q", ownerUserId: "u1", multiHop: true });
  expect(JSON.parse(calls[0].body).multi_hop).toBe(true);
});

test("multiHop 未指定なら multi_hop を送らない", async () => {
  const calls: Array<{ body: string }> = [];
  vi.mocked(ragFetch).mockImplementation(async (_path: string, init: { body: string }) => {
    calls.push({ body: init.body });
    return new Response(JSON.stringify({ chunks: [] }), { status: 200 });
  });
  await retrieveChunks({ query: "q", ownerUserId: "u1" });
  expect("multi_hop" in JSON.parse(calls[0].body)).toBe(false);
});
```

> 注: `retrieve-client.test.ts` が `ragFetch` をどうモックしているか先頭を確認し、上記の `vi.mocked(ragFetch)` 形へ合わせる（既存のモック宣言を再利用。未モックなら `vi.mock("@/lib/rag-client", () => ({ ragFetch: vi.fn() }))` を先頭に追加し `import { ragFetch } from "@/lib/rag-client"` する）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/agent/retrieve-client.test.ts`
Expected: FAIL（`multiHop` 未対応 / body に multi_hop が出ない）

- [ ] **Step 3: Write minimal implementation** — `src/lib/agent/retrieve-client.ts`

`retrieveChunks` の input 型に `multiHop?: boolean;` を追加し、body に追加:
```ts
      document_ids: input.documentIds ?? null,
      multi_hop: input.multiHop ?? undefined,
```
`retrieveChunksStream` の input 型にも同様に `multiHop?: boolean;` を追加し、body に同じ行を追加する。

> `?? undefined` により未指定時は `JSON.stringify` がキーごと省く＝サーバ既定 false（挙動不変）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/agent/retrieve-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/retrieve-client.ts src/lib/agent/retrieve-client.test.ts
git commit -m "feat: rag-client が multi_hop を透過できるよう最小対応"
```

---

## Task 10: 全体ゲート

**Files:** なし（検証のみ）

- [ ] **Step 1: rag ユニットテスト（変更領域）**

Run: `docker compose exec -T rag uv run pytest rag/tests/test_multihop.py rag/tests/test_retrieve_api.py rag/tests/test_eval_report.py -q`
Expected: 全 PASS

- [ ] **Step 2: TS 型・lint・テスト（rag-client 変更分）**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/lib/agent/retrieve-client.test.ts`
Expected: tsc 0 / lint 0 / テスト PASS

- [ ] **Step 3: 差分があれば最終コミット**

```bash
git add -A && git commit -m "test: 多ホップ Python 実装の全体ゲートを通過" || echo "差分なし"
```

> rag-eval-full の実 recall@k / fact_coverage 改善測定と multi-hop baseline JSON の commit は self-hosted GPU runner 上で行う（ローカル/本 plan の範囲外）。

---

## Self-Review メモ（plan 作成者による確認結果）

- **Spec coverage**: multihop.py（`_rrf_fuse`=T1 / `_prf_query`=T2 / `retrieve_multihop`=T3 / `retrieve_multihop_stream`=T4）/ schema フラグ=T5 / ルータ分岐=T6 / eval `--multi-hop`+baseline=T7 / CI=T8 / TS 透過=T9 / ゲート=T10。spec の無条件発火は T3 の実装（hop-1 非空で常時 hop-2）に反映。範囲外（TS エージェント既定 ON・gate 実測引き上げ・baseline 全数値）は spec/plan とも非対象で一致。
- **Placeholder scan**: コードステップは実コード記載。GPU 依存の数値生成は「runner で実行」と明記（プレースホルダではなく作業分担）。
- **Type consistency**: `_rrf_fuse(hop1, hop2, *, top_k, bridge_quota=2)` / `_prf_query(query, hop1, *, n_docs, char_budget)` / `retrieve_multihop(..., max_hops=1)` / `retrieve_multihop_stream(...)` のシグネチャは T1–T6・router・eval で一貫。`RetrievedChunk` のフィールド（chunk_id/document_title/text/expanded_text 等）は schemas.py 実体と一致。`multi_hop`（snake, API/Python）と `multiHop`（camel, TS）の対応も整合。
