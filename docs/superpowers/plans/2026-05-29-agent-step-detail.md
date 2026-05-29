# 検索サブステップ詳細展開 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** retrieve の子サブステップ（embed/vector_search/bm25_search/rerank/expand）に候補一覧・リランク内訳などの詳細を載せ、card/timeline/log の3バリアントすべてで展開表示する。

**Architecture:** バックエンドの NDJSON `done` イベントに詳細（hits/selected/model/dims/count）を追加 → TS クライアントが pass-through → tools.ts が各段階の input/output を構築 → UI が既存 `ToolInputBlock`/`ToolOutputBlock` を拡張＋サブステップを展開可能にし、log には詳細行を追記。

**Tech Stack:** FastAPI / SQLAlchemy / Python、Next.js / TypeScript、Vitest、pytest。

**設計書:** `docs/superpowers/specs/2026-05-29-agent-step-detail-design.md`

---

## ファイル構成
- Modify: `rag/app/embedding/base.py`, `rag/app/embedding/bge_m3.py`, `rag/app/embedding/factory.py`（embedder の `name`）
- Modify: `rag/app/reranker/base.py`, `rag/app/reranker/bge.py`, `rag/app/reranker/factory.py`（reranker の `name`）
- Modify: `rag/app/retrieval/service.py`（done イベント詳細化）+ `rag/tests/test_retrieval_service.py`
- Modify: `src/lib/agent/retrieve-client.ts`（`RetrieveStageEvent` 拡張）+ `src/lib/agent/retrieve-client.test.ts`
- Modify: `src/lib/agent/tools.ts`（`stageToEvent` の input/output 構築）+ `src/lib/agent/tools.test.ts`
- Modify: `src/components/chat/tool-steps.tsx`（詳細描画・展開・log 詳細行）

---

## Task 1: embedder / reranker にモデル名 `name` を追加

**Files:**
- Modify: `rag/app/embedding/base.py`, `rag/app/embedding/bge_m3.py`, `rag/app/embedding/factory.py`
- Modify: `rag/app/reranker/base.py`, `rag/app/reranker/bge.py`, `rag/app/reranker/factory.py`
- Test: `rag/tests/test_embedding_factory.py`（既存ファイルに追記）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_embedding_factory.py` の末尾に追記:

```python
def test_stub_embedder_and_reranker_expose_name():
    from app.embedding.factory import StubEmbedder
    from app.reranker.factory import StubReranker
    assert StubEmbedder(dim=8).name == "stub"
    assert StubReranker().name == "stub"
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd rag && uv run pytest tests/test_embedding_factory.py::test_stub_embedder_and_reranker_expose_name -v`
Expected: FAIL（`AttributeError: 'StubEmbedder' object has no attribute 'name'`）

- [ ] **Step 3: 最小実装**

`rag/app/embedding/base.py` の `Embedder` Protocol に `name` を追加:

```python
class Embedder(Protocol):
    dim: int
    name: str

    def embed(self, texts: list[str]) -> list[DenseSparse]: ...
```

`rag/app/reranker/base.py` の `Reranker` Protocol に `name` を追加:

```python
from typing import Protocol


class Reranker(Protocol):
    name: str

    def score(self, query: str, docs: list[str]) -> list[float]: ...
```

`rag/app/embedding/factory.py` の `StubEmbedder.__init__` に `name` を設定（既存の `self.dim = dim` の直後）:

```python
    def __init__(self, dim: int = 8):
        self.dim = dim
        self.name = "stub"
```

`rag/app/embedding/bge_m3.py` の `BGEM3Embedder.__init__` で、`self.model = BGEM3FlagModel("BAAI/bge-m3", ...)` の直後に追加:

```python
        self.name = "BAAI/bge-m3"
```

`rag/app/reranker/factory.py` の `StubReranker` クラスにクラス属性を追加（`class StubReranker:` 直下、docstring の後）:

```python
class StubReranker:
    """文字 n-gram 重なりで擬似スコア（テスト/オフライン用）。"""
    name = "stub"

    def score(self, query: str, docs: list[str]) -> list[float]:
        ...
```

`rag/app/reranker/bge.py` の `BGEReranker.__init__` で `self.model = FlagReranker(...)` の直後に追加:

```python
        self.name = "BAAI/bge-reranker-v2-m3"
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_embedding_factory.py tests/test_reranker_factory.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add rag/app/embedding/base.py rag/app/embedding/bge_m3.py rag/app/embedding/factory.py rag/app/reranker/base.py rag/app/reranker/bge.py rag/app/reranker/factory.py rag/tests/test_embedding_factory.py
git commit -m "feat: embedder/reranker にモデル名 name を公開"
```
（コミットメッセージ末尾に必ず付与）
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 2: service.py の done イベントを詳細化

**Files:**
- Modify: `rag/app/retrieval/service.py`
- Modify: `rag/tests/test_retrieval_service.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_retrieval_service.py` に追記（既存 import の `retrieve_stream` を流用）:

```python
def test_retrieve_stream_done_events_carry_detail():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection="test_detail_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="設計.pdf", mime="application/pdf",
                   size=1, raw_path="/tmp/x", status="ready")
    session.add(doc); session.flush()
    bodies = ["認証トークンは24時間で失効する。", "請求書の発行手順。", "次の文脈。"]
    rows = []
    for i, b in enumerate(bodies):
        c = Chunk(document_id=doc.id, ordinal=i, heading_path=f"H{i}", page_start=0,
                  page_end=0, block_type="text", token_len=len(b), text=b)
        session.add(c); session.flush(); rows.append(c)
    session.commit()
    store.upsert([
        {"chunk_id": c.id, "document_id": doc.id, "owner_user_id": "u1",
         "heading_path": c.heading_path, "page_start": 0, "page_end": 0, "block_type": "text",
         "source_type": "doc", "text": c.text, "vector": e.embed([c.text])[0]}
        for c in rows
    ])

    events = list(retrieve_stream(session, store, e, r, query="認証トークン 失効",
                                  owner_user_id="u1", top_k=2, candidate_k=10))
    by = {}
    for ev in events:
        if ev.get("status") == "done":
            by[ev["stage"]] = ev

    embed = by["embed"]
    assert embed["model"] == "stub" and embed["dims"] == 8

    vs = by["vector_search"]
    assert isinstance(vs["hits"], list) and vs["hits"]
    assert set(vs["hits"][0].keys()) == {"title", "heading", "score"}
    assert vs["hits"][0]["title"] == "設計.pdf"

    rr = by["rerank"]
    assert rr["model"] == "stub" and rr["top_n"] == 2
    assert isinstance(rr["selected"], list) and rr["selected"]
    assert set(rr["selected"][0].keys()) == {"id", "score", "title"}

    exp = by["expand"]
    assert exp["count"] == len(rr["selected"])

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit(); session.close()
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd rag && uv run pytest tests/test_retrieval_service.py::test_retrieve_stream_done_events_carry_detail -v`
Expected: FAIL（`KeyError: 'model'` など — 詳細フィールド未実装）

- [ ] **Step 3: 最小実装**

`rag/app/retrieval/service.py` の `_timed` 関数の直後に `_hit_rows` ヘルパを追加:

```python
def _hit_rows(session: Session, hits: list[dict], title_cache: dict[str, str]) -> list[dict]:
    rows = []
    for h in hits:
        doc_id = h["document_id"]
        if doc_id not in title_cache:
            doc = session.get(Document, doc_id)
            title_cache[doc_id] = doc.filename if doc else doc_id
        rows.append({"title": title_cache[doc_id],
                     "heading": h.get("heading_path", ""),
                     "score": float(h.get("score", 0.0))})
    return rows
```

`retrieve_stream` の本体を以下で全置換（`title_cache` を先頭に移し、各 done に詳細を載せる）:

```python
def retrieve_stream(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
                    *, query: str, owner_user_id: str, top_k: int = 6,
                    candidate_k: int = 40) -> Iterator[dict]:
    title_cache: dict[str, str] = {}

    # 1) embed（1回の呼び出しで dense+sparse の両方を得る）
    yield {"stage": "embed", "status": "start"}
    t = time.perf_counter()
    qv = embedder.embed([query])[0]
    yield {"stage": "embed", "status": "done", "ms": _ms(t),
           "model": getattr(embedder, "name", "?"), "dims": len(qv.dense)}

    # 2) dense / sparse 検索を並行実行（性能大前提）。両 start を先に出す。
    yield {"stage": "vector_search", "status": "start"}
    yield {"stage": "bm25_search", "status": "start"}
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_dense = ex.submit(_timed, store.dense_search, qv.dense, owner_user_id, candidate_k)
        f_sparse = ex.submit(_timed, store.sparse_search, qv.sparse, owner_user_id, candidate_k)
        dense_hits, dense_ms = f_dense.result()
        yield {"stage": "vector_search", "status": "done", "ms": dense_ms,
               "count": len(dense_hits), "hits": _hit_rows(session, dense_hits, title_cache)}
        sparse_hits, sparse_ms = f_sparse.result()
        yield {"stage": "bm25_search", "status": "done", "ms": sparse_ms,
               "count": len(sparse_hits), "hits": _hit_rows(session, sparse_hits, title_cache)}

    if not dense_hits and not sparse_hits:
        yield {"stage": "rerank", "status": "start"}
        yield {"stage": "rerank", "status": "done", "ms": 0, "count": 0,
               "model": getattr(reranker, "name", "?"), "top_n": top_k, "selected": []}
        yield {"stage": "expand", "status": "start"}
        yield {"stage": "expand", "status": "done", "ms": 0, "count": 0}
        yield {"stage": "result", "chunks": []}
        return

    # 3) round-robin マージ + candidate_k 打ち切り
    merged = _merge_round_robin(dense_hits, sparse_hits, candidate_k)

    # 4) rerank
    yield {"stage": "rerank", "status": "start"}
    tr = time.perf_counter()
    scores = reranker.score(query, [h["text"] for h in merged])
    ranked = sorted(zip(merged, scores), key=lambda x: x[1], reverse=True)[:top_k]
    selected = [{"id": h["chunk_id"], "score": float(s),
                 "title": title_cache.get(h["document_id"], h["document_id"])}
                for h, s in ranked]
    yield {"stage": "rerank", "status": "done", "ms": _ms(tr), "count": len(ranked),
           "model": getattr(reranker, "name", "?"), "top_n": top_k, "selected": selected}

    # 5) expand + RetrievedChunk 構築
    yield {"stage": "expand", "status": "start"}
    te = time.perf_counter()
    out: list[RetrievedChunk] = []
    for hit, score in ranked:
        doc_id = hit["document_id"]
        if doc_id not in title_cache:
            doc = session.get(Document, doc_id)
            title_cache[doc_id] = doc.filename if doc else doc_id
        chunk = session.get(Chunk, hit["chunk_id"])
        expanded = "" if chunk is None else _expand(session, doc_id, chunk.ordinal)
        out.append(RetrievedChunk(
            chunk_id=hit["chunk_id"], document_id=doc_id,
            document_title=title_cache[doc_id], heading_path=hit.get("heading_path", ""),
            page_start=hit.get("page_start", 0), page_end=hit.get("page_end", 0),
            block_type=hit.get("block_type", "text"), text=hit["text"],
            expanded_text=expanded, score=float(score)))
    yield {"stage": "expand", "status": "done", "ms": _ms(te), "count": len(out)}
    yield {"stage": "result", "chunks": out}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_retrieval_service.py -v`
Expected: PASS（新テスト + 既存3テスト）

- [ ] **Step 5: コミット**

```bash
git add rag/app/retrieval/service.py rag/tests/test_retrieval_service.py
git commit -m "feat: 検索段階の done イベントに候補・リランク内訳の詳細を追加"
```
（Co-Authored-By トレーラを付与）

---

## Task 3: RetrieveStageEvent に詳細フィールドを追加（pass-through）

**Files:**
- Modify: `src/lib/agent/retrieve-client.ts`
- Modify: `src/lib/agent/retrieve-client.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/retrieve-client.test.ts` に追記（既存の `retrieveChunksStream`/`RetrieveStageEvent` import を流用）:

```typescript
test("retrieveChunksStream forwards detail fields (hits/selected/model/dims)", async () => {
  const ndjson =
    '{"stage":"embed","status":"done","ms":1,"model":"BAAI/bge-m3","dims":1024}\n' +
    '{"stage":"vector_search","status":"done","ms":2,"count":1,"hits":[{"title":"t","heading":"H","score":0.8}]}\n' +
    '{"stage":"rerank","status":"done","ms":3,"count":1,"model":"BAAI/bge-reranker-v2-m3","top_n":6,"selected":[{"id":"c1","score":0.04,"title":"t"}]}\n' +
    '{"stage":"result","chunks":[]}\n';
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(ndjson, { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const stages: RetrieveStageEvent[] = [];
  await retrieveChunksStream({ query: "q", ownerUserId: "u1", onStage: (e) => stages.push(e) });

  const embed = stages.find((s) => s.stage === "embed")!;
  expect(embed.model).toBe("BAAI/bge-m3");
  expect(embed.dims).toBe(1024);
  const vs = stages.find((s) => s.stage === "vector_search")!;
  expect(vs.hits).toEqual([{ title: "t", heading: "H", score: 0.8 }]);
  const rr = stages.find((s) => s.stage === "rerank")!;
  expect(rr.top_n).toBe(6);
  expect(rr.selected).toEqual([{ id: "c1", score: 0.04, title: "t" }]);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run src/lib/agent/retrieve-client.test.ts`
Expected: FAIL（型エラー: `Property 'model' does not exist on type 'RetrieveStageEvent'`、または tsc 失敗）

- [ ] **Step 3: 最小実装**

`src/lib/agent/retrieve-client.ts` の `RetrieveStageEvent` を以下で置換:

```typescript
export interface RetrieveStageEvent {
  stage: string;
  status: "start" | "done" | "error";
  ms?: number;
  count?: number;
  message?: string;
  model?: string;
  dims?: number;
  top_n?: number;
  hits?: { title: string; heading: string; score: number }[];
  selected?: { id: string; score: number; title: string }[];
}
```

（`retrieveChunksStream` 本体は変更不要。`result` 以外のイベントは既に `onStage` にそのまま渡される。）

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run src/lib/agent/retrieve-client.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / tsc クリーン

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/retrieve-client.ts src/lib/agent/retrieve-client.test.ts
git commit -m "feat: RetrieveStageEvent に候補・リランク詳細フィールドを追加"
```
（Co-Authored-By トレーラを付与）

---

## Task 4: tools.ts stageToEvent で各段階の input/output を構築

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Modify: `src/lib/agent/tools.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/tools.test.ts` の retrieve-client mock を、詳細付きの `retrieveChunksStream` に更新（既存 mock を置換）:

```typescript
vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(),
  retrieveChunksStream: vi.fn(async ({ onStage }: { onStage: (e: Record<string, unknown>) => void }) => {
    onStage({ stage: "embed", status: "done", ms: 1, model: "BAAI/bge-m3", dims: 1024 });
    onStage({ stage: "vector_search", status: "done", ms: 2, count: 1, hits: [{ title: "設計.pdf", heading: "認証", score: 0.8 }] });
    onStage({ stage: "rerank", status: "done", ms: 3, count: 1, model: "bge", top_n: 6, selected: [{ id: "c1", score: 0.04, title: "設計.pdf" }] });
    return [{
      chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
      pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
      expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
    }];
  }),
  fetchDocument: vi.fn(async () => ({
    documentId: "d1", documentTitle: "設計.pdf",
    chunks: [{ chunkId: "c2", ordinal: 1, headingPath: "認可", pageStart: 0, pageEnd: 0,
      blockType: "text", text: "認可の本文。" }],
  })),
}));
```

新テストを追記（既存の `StepBus`/`AgentEvent` import を流用）:

```typescript
test("stageToEvent populates per-stage input/output detail", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const bus = new StepBus();
  const events: AgentEvent[] = [];
  const drain = (async () => { for await (const e of bus) events.push(e); })();

  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus });
  await tools.retrieve.execute!({ query: "認証は?" }, { toolCallId: "call-1", messages: [] } as never);
  bus.close();
  await drain;

  const steps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step").map((e) => e.step);
  const vs = steps.find((s) => s.name === "vector_search" && s.status === "done")!;
  expect(vs.input).toMatchObject({ mode: "dense", query: "認証は?" });
  expect((vs.output as { hits: unknown[] }).hits).toHaveLength(1);
  const rr = steps.find((s) => s.name === "rerank" && s.status === "done")!;
  expect(rr.input).toMatchObject({ model: "bge", top_n: 6 });
  expect((rr.output as { selected: unknown[] }).selected).toHaveLength(1);
  const embed = steps.find((s) => s.name === "embed" && s.status === "done")!;
  expect(embed.output).toMatchObject({ dims: 1024 });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run src/lib/agent/tools.test.ts`
Expected: FAIL（input/output に詳細が入っていない）

- [ ] **Step 3: 最小実装**

`src/lib/agent/tools.ts` の `stageToEvent` 関数を以下で全置換（`query` 引数を追加し、done 時に段階別の input/output を構築）:

```typescript
/** done 時の段階別 input を組み立てる。 */
function stageInput(ev: RetrieveStageEvent, query: string): Record<string, unknown> {
  switch (ev.stage) {
    case "embed": return ev.model ? { model: ev.model } : {};
    case "vector_search": return { mode: "dense", query };
    case "bm25_search": return { mode: "sparse", query };
    case "rerank": return { model: ev.model ?? null, top_n: ev.top_n ?? null };
    default: return {};
  }
}

/** done 時の段階別 output を組み立てる。 */
function stageOutput(ev: RetrieveStageEvent): Record<string, unknown> | null {
  switch (ev.stage) {
    case "embed": return ev.dims != null ? { dims: ev.dims } : null;
    case "vector_search":
    case "bm25_search": return { count: ev.count ?? 0, hits: ev.hits ?? [] };
    case "rerank": return { count: ev.count ?? 0, selected: ev.selected ?? [] };
    case "expand": return { count: ev.count ?? 0 };
    default: return ev.count != null ? { count: ev.count } : null;
  }
}

/** retrieve の段階イベントを parentId 付きサブステップへ変換して bus に流す。 */
function stageToEvent(ev: RetrieveStageEvent, parentId: string, query: string): AgentEvent {
  // start と done は同一 id を共有し、reducer が id マージで running→done に更新する（衝突ではなく意図）。
  const base = {
    id: `${parentId}:${ev.stage}`,
    name: ev.stage as ToolName,
    parentId,
    label: STAGE_LABEL[ev.stage] ?? ev.stage,
  };
  if (ev.status === "start") {
    return { type: "step", step: { ...base, status: "running", durationMs: 0, input: {}, output: null, summary: stageRunningSummary(ev.stage) } };
  }
  if (ev.status === "error") {
    return { type: "step", step: { ...base, status: "error", durationMs: ev.ms ?? 0, input: {}, output: { error: ev.message ?? "失敗" }, summary: "段階に失敗" } };
  }
  return { type: "step", step: { ...base, status: "done", durationMs: ev.ms ?? 0, input: stageInput(ev, query), output: stageOutput(ev), summary: stageDoneSummary(ev.stage, ev.count) } };
}
```

`buildTools` 内の `retrieve` の `execute` で `onStage` 呼び出しに `query` を渡す:

```typescript
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, query)),
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run src/lib/agent/tools.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / tsc クリーン

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/tools.ts src/lib/agent/tools.test.ts
git commit -m "feat: サブステップに段階別の入力・出力詳細を載せる"
```
（Co-Authored-By トレーラを付与）

---

## Task 5: tool-steps.tsx で詳細を3バリアント描画

**Files:**
- Modify: `src/components/chat/tool-steps.tsx`

このタスクはユニットテストなし（描画）。`pnpm exec tsc --noEmit`・`pnpm lint`・既存 `src/hooks/use-agent-reduce.test.ts` で検証する。

- [ ] **Step 1: LOG_DETAIL_MAX 定数と候補ヒット型を追加**

`src/components/chat/tool-steps.tsx` の先頭付近（`import` 群の直後）に追加:

```typescript
const LOG_DETAIL_MAX = 8;

interface CandidateHit {
  title: string;
  heading: string;
  score: number;
}
```

- [ ] **Step 2: ToolInputBlock に vector_search/bm25_search/rerank/embed の入力描画を追加**

`ToolInputBlock` 内、`if (step.name === "fetch_document") { ... }` ブロックの直後（`return <pre ...>` の前）に追加:

```typescript
  if (step.name === "vector_search" || step.name === "bm25_search") {
    const rows: { k: string; v: React.ReactNode }[] = [];
    if (typeof step.input.mode === "string") rows.push({ k: "mode", v: step.input.mode });
    return (
      <div className="space-y-2">
        {rows.length > 0 && <KeyValueGrid rows={rows} />}
        {typeof step.input.query === "string" && (
          <div className="rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-2">query</div>
            <div className="text-[12.5px] leading-[1.5] text-fg">{step.input.query}</div>
          </div>
        )}
      </div>
    );
  }
  if (step.name === "rerank") {
    const rows: { k: string; v: React.ReactNode }[] = [];
    if (step.input.model != null) rows.push({ k: "model", v: String(step.input.model) });
    if (step.input.top_n != null) rows.push({ k: "top_n", v: String(step.input.top_n) });
    if (rows.length) return <KeyValueGrid rows={rows} />;
  }
  if (step.name === "embed" && step.input.model != null) {
    return <KeyValueGrid rows={[{ k: "model", v: String(step.input.model) }]} />;
  }
```

- [ ] **Step 3: ToolOutputBlock に候補一覧／embed／expand の出力描画を追加**

`ToolOutputBlock` 内、`if (step.name === "rerank" && Array.isArray(output.selected)) { ... }` ブロックの直後に追加（rerank の selected 描画は既存のまま流用）:

```typescript
  if ((step.name === "vector_search" || step.name === "bm25_search") && Array.isArray(output.hits)) {
    const hits = output.hits as CandidateHit[];
    const max = Math.max(...hits.map((h) => h.score), 1e-9);
    if (hits.length === 0) {
      return <div className="px-1 py-1 text-[11.5px] text-muted">候補なし</div>;
    }
    return (
      <div className="flex max-h-72 flex-col gap-[5px] overflow-y-auto py-1">
        {hits.map((h, i) => (
          <div
            key={i}
            className="grid grid-cols-[64px_42px_1fr] items-center gap-2.5 text-[11.5px] max-md:grid-cols-[54px_38px_1fr] max-md:gap-2"
          >
            <div className="h-[5px] overflow-hidden rounded-full bg-divider">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (h.score / max) * 100)}%` }} />
            </div>
            <span className="font-mono text-[11px] font-semibold text-accent">{h.score.toFixed(2)}</span>
            <span className="truncate text-fg-2">
              <span className="text-fg">{h.title}</span>
              {h.heading && <span className="text-muted-2"> — {h.heading}</span>}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (step.name === "embed") {
    return <KeyValueGrid rows={[{ k: "dims", v: String(output.dims ?? "—") }]} />;
  }
  if (step.name === "expand") {
    return <KeyValueGrid rows={[{ k: "拡張件数", v: String(output.count ?? 0) }]} />;
  }
```

- [ ] **Step 4: SubStepRow を展開可能化し、SubSteps に展開状態を渡す**

`SubStepRow` と `SubSteps` を以下で全置換（`isExpandable`・`sectionLabelCls`・`ToolInputBlock`・`ToolOutputBlock`・`hasInputData` は既存を流用）:

```typescript
/** 子サブステップの行。詳細があれば展開可能。card / timeline 共通。 */
function SubStepRow({ step, expanded, onToggle }: { step: ToolCall; expanded: boolean; onToggle: () => void }) {
  const expandable = isExpandable(step);
  const showInput = hasInputData(step.input);
  const showOutput = step.output != null;
  return (
    <div>
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? expanded : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 border-0 bg-transparent py-[3px] text-left text-[11.5px] text-fg-2",
          expandable ? "cursor-pointer hover:text-fg" : "cursor-default",
        )}
      >
        <StatusIcon status={step.status} />
        <span className="grid place-items-center text-muted-2">
          <svg viewBox="0 0 16 16" width="12" height="12">{TOOL_ICONS[step.name]}</svg>
        </span>
        <span className="font-mono text-[11px] font-semibold text-fg-2">{step.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{step.summary}</span>
        <span className="font-mono text-[10.5px] tabular-nums text-muted-2">{formatMs(step.durationMs)}</span>
        {expandable ? (
          <span className={cn("text-muted-2 transition-transform", expanded && "rotate-180")}>
            <svg viewBox="0 0 16 16" width="10" height="10">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span aria-hidden className="block h-[10px] w-[10px]" />
        )}
      </button>
      {expandable && expanded && (
        <div className="flex flex-col gap-2 pb-2 pl-[26px] pt-1">
          {showInput && (
            <div>
              <div className={sectionLabelCls}>入力</div>
              <ToolInputBlock step={step} />
            </div>
          )}
          {showOutput && (
            <div>
              <div className={sectionLabelCls}>出力</div>
              <ToolOutputBlock step={step} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubSteps({ steps, expandedMap, onToggleStep }: {
  steps: ToolCall[] | undefined;
  expandedMap: Record<string, boolean>;
  onToggleStep: (id: string) => void;
}) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="flex flex-col gap-px border-l-[1.5px] border-divider pl-3 ml-[7px]">
      {steps.map((s) => (
        <SubStepRow key={s.id} step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: ToolSteps の card / timeline で SubSteps に展開状態を渡す**

`ToolSteps` 内の 2 箇所の `<SubSteps steps={childrenOf.get(s.id)} />` を、以下に置換（timeline・card 両方）:

```typescript
<SubSteps steps={childrenOf.get(s.id)} expandedMap={expandedMap} onToggleStep={onToggleStep} />
```

- [ ] **Step 6: ToolStepLog に詳細行を追記**

`ToolStepLog` 内の `if (s.status === "done") { ... }` ブロックを以下で置換（done 行の後に詳細行を追加し、`t` 更新は最後に行う）:

```typescript
    if (s.status === "done") {
      lines.push({ t: start + s.durationMs, name: logName, msg: `done in ${formatMs(s.durationMs)} · ${s.summary}`, kind: "done" });
      const out = (s.output ?? {}) as Record<string, unknown>;
      const dt = start + s.durationMs;
      if ((s.name === "vector_search" || s.name === "bm25_search") && Array.isArray(out.hits)) {
        const hits = out.hits as { title: string; heading: string; score: number }[];
        hits.slice(0, LOG_DETAIL_MAX).forEach((h) =>
          lines.push({ t: dt, name: "", msg: `${h.score.toFixed(2)}  ${h.title}${h.heading ? ` — ${h.heading}` : ""}`, kind: "detail" }));
        if (hits.length > LOG_DETAIL_MAX)
          lines.push({ t: dt, name: "", msg: `… 他 ${hits.length - LOG_DETAIL_MAX} 件`, kind: "detail" });
      } else if (s.name === "rerank" && Array.isArray(out.selected)) {
        const sel = out.selected as { score: number; title: string }[];
        sel.slice(0, LOG_DETAIL_MAX).forEach((h) =>
          lines.push({ t: dt, name: "", msg: `${h.score.toFixed(2)}  ${h.title}`, kind: "detail" }));
        if (sel.length > LOG_DETAIL_MAX)
          lines.push({ t: dt, name: "", msg: `… 他 ${sel.length - LOG_DETAIL_MAX} 件`, kind: "detail" });
      }
      t = start + s.durationMs;
    } else if (s.status === "running") {
```

そして詳細行の色付けのため、render の `msg` 用 `cn(...)` に `detail` を追加。`l.kind === "running" ? "text-accent"` の直後に `: l.kind === "detail" ? "text-muted-2"` を挿入:

```typescript
            className={cn(
              "min-w-0 flex-1 break-words",
              l.kind === "done" ? "text-fg" : l.kind === "param" ? "text-muted" : l.kind === "running" ? "text-accent" : l.kind === "detail" ? "text-muted-2" : "text-fg-2",
            )}
```

- [ ] **Step 7: 型・lint・既存テスト**

Run:
```
cd /Users/ansen/Documents/playground/a-rag && pnpm exec tsc --noEmit
pnpm lint
pnpm exec vitest run src/hooks/use-agent-reduce.test.ts
```
Expected: tsc クリーン / lint パス / reducer テスト PASS

- [ ] **Step 8: コミット**

```bash
git add src/components/chat/tool-steps.tsx
git commit -m "feat: 検索サブステップの詳細を card/timeline/log で展開表示"
```
（Co-Authored-By トレーラを付与）

---

## 最終確認

- [ ] **バックエンド全テスト**: `cd rag && uv run pytest -q` → 全 PASS
- [ ] **フロント全テスト + 型 + lint**: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm lint` → 全 PASS
- [ ] **rag コンテナ再ビルド（手動反映）**: `docker compose up -d --build rag`（コードはイメージ焼き込みのため再ビルド必須）。`/retrieve/stream` の done に hits/selected が載ることを確認。
- [ ] **手動確認**: 質問を投げ、retrieve 配下の vector_search/bm25_search を展開すると候補一覧、rerank を展開するとスコアバー、log 表示でも詳細行が出ることを card/timeline/log それぞれで確認。
