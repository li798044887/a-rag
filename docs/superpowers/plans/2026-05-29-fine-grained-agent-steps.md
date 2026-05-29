# エージェント実行ログ細粒度化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** retrieve ツールの内部段階（埋め込み・密ベクトル検索・BM25・リランク・近傍拡張）を rag バックエンドから NDJSON でストリーミングし、エージェントログに `retrieve` の子サブステップとしてライブ表示する。

**Architecture:** rag 側は `retrieve` を段階イベント yield のジェネレータ化し、dense/sparse 検索を分割・並行実行（性能大前提）して round-robin マージ + candidate_k 打ち切りで rerank 入力を据え置く。`POST /retrieve/stream` が NDJSON を配信。Next.js 側は `StepBus`（サイドチャネル）で `retrieve` ツールの execute から `runAgent` ジェネレータへサブステップを流し込み、UI は親子ネストで描画する。

**Tech Stack:** FastAPI / SQLAlchemy / qdrant-client（Python, ThreadPoolExecutor）、Next.js / TypeScript / Vercel AI SDK、Vitest、pytest。

**設計書:** `docs/superpowers/specs/2026-05-29-fine-grained-agent-steps-design.md`

---

## ファイル構成

**バックエンド (`rag/`)**
- Modify: `rag/app/vectorstore/qdrant.py` — `dense_search` / `sparse_search` を追加、`hybrid_search` を削除
- Modify: `rag/app/retrieval/service.py` — `retrieve_stream` ジェネレータ + `retrieve` drain ラッパ
- Modify: `rag/app/routers/retrieve.py` — `POST /retrieve/stream` 追加
- Modify: `rag/tests/test_qdrant_store.py`（または新規）— dense/sparse 検索テスト
- Delete: `rag/tests/test_hybrid_search.py`
- Modify: `rag/tests/test_retrieval_service.py` — `retrieve_stream` の段階列・マージのテスト
- Modify: `rag/tests/test_retrieve_api.py` — `/retrieve/stream` のテスト

**Next.js (`src/`)**
- Modify: `src/lib/types.ts` — `ToolName` に `embed`/`expand`、`ToolCall` に `parentId?`
- Create: `src/lib/agent/step-bus.ts` — `StepBus`
- Create: `src/lib/agent/step-bus.test.ts`
- Modify: `src/lib/agent/retrieve-client.ts` — `retrieveChunksStream` + 共有 `mapChunk`
- Modify: `src/lib/agent/retrieve-client.test.ts`
- Modify: `src/lib/agent/tools.ts` — `retrieve` を stream 化、`buildTools` に `bus`
- Modify: `src/lib/agent/tools.test.ts`
- Modify: `src/lib/agent/run.ts` — `pump` + bus drain + `rewrite_query`
- Modify: `src/lib/agent/run.test.ts`
- Modify: `src/components/chat/tool-steps.tsx` — 親子ネスト描画 + アイコン
- Modify: `src/components/chat/agent-activity.tsx` — トップレベル集計 + running leaf

---

## Task 1: Qdrant に dense_search / sparse_search を追加

**Files:**
- Modify: `rag/app/vectorstore/qdrant.py`
- Modify: `rag/tests/test_qdrant_store.py`
- Delete: `rag/tests/test_hybrid_search.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_qdrant_store.py` の末尾に追記（既存の import / ヘルパは流用。無ければ以下の `_row` を追加）:

```python
import uuid
from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore

_SPLIT_COLL = "test_split_" + uuid.uuid4().hex[:8]


def _split_row(e, text, owner="u1", doc="d1"):
    return {
        "chunk_id": str(uuid.uuid4()), "document_id": doc, "owner_user_id": owner,
        "heading_path": "H", "page_start": 0, "page_end": 0, "block_type": "text",
        "source_type": "doc", "text": text, "vector": e.embed([text])[0],
    }


def test_dense_and_sparse_search_filter_owner():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=_SPLIT_COLL, dim=8)
    store.ensure_collection()
    store.upsert([_split_row(e, "認証トークンの失効", owner="u1"),
                  _split_row(e, "他人の文書", owner="u2")])
    qv = e.embed(["認証トークンの失効"])[0]

    dense = store.dense_search(qv.dense, owner_user_id="u1", limit=10)
    sparse = store.sparse_search(qv.sparse, owner_user_id="u1", limit=10)

    assert dense and sparse
    assert all(h["owner_user_id"] == "u1" for h in dense)   # u2 は除外
    assert all(h["owner_user_id"] == "u1" for h in sparse)
    assert all("chunk_id" in h and "text" in h and "score" in h for h in dense)
    store.drop()
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd rag && uv run pytest tests/test_qdrant_store.py::test_dense_and_sparse_search_filter_owner -v`
Expected: FAIL（`AttributeError: 'QdrantStore' object has no attribute 'dense_search'`）

- [ ] **Step 3: 最小実装**

`rag/app/vectorstore/qdrant.py` の `hybrid_search` メソッド（`qdrant.py:51-76`）を削除し、代わりに以下を追加:

```python
    def _owner_filter(self, owner_user_id: str) -> models.Filter:
        return models.Filter(must=[models.FieldCondition(
            key="owner_user_id", match=models.MatchValue(value=owner_user_id))])

    @staticmethod
    def _payloads(res) -> list[dict]:
        out = []
        for p in res.points:
            payload = dict(p.payload or {})
            payload["score"] = p.score
            out.append(payload)
        return out

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def dense_search(self, query_dense: list[float], owner_user_id: str, limit: int = 40) -> list[dict]:
        if not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection, query=query_dense, using=DENSE, limit=limit,
            query_filter=self._owner_filter(owner_user_id), with_payload=True)
        return self._payloads(res)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def sparse_search(self, query_sparse: dict[int, float], owner_user_id: str, limit: int = 40) -> list[dict]:
        if not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection,
            query=models.SparseVector(indices=list(query_sparse.keys()), values=list(query_sparse.values())),
            using=SPARSE, limit=limit,
            query_filter=self._owner_filter(owner_user_id), with_payload=True)
        return self._payloads(res)
```

- [ ] **Step 4: 旧 hybrid_search のテストを削除**

Run: `cd rag && rm tests/test_hybrid_search.py`

- [ ] **Step 5: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_qdrant_store.py -v`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add rag/app/vectorstore/qdrant.py rag/tests/test_qdrant_store.py rag/tests/test_hybrid_search.py
git commit -m "refactor: Qdrant 融合検索を dense/sparse 検索に分割"
```

---

## Task 2: service を retrieve_stream ジェネレータへ再構成

**Files:**
- Modify: `rag/app/retrieval/service.py`
- Modify: `rag/tests/test_retrieval_service.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_retrieval_service.py` に追記:

```python
from app.retrieval.service import retrieve_stream


def test_retrieve_stream_emits_stages_in_order():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection="test_strm_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="設計.pdf", mime="application/pdf",
                   size=1, raw_path="/tmp/x", status="ready")
    session.add(doc); session.flush()
    bodies = ["前の文脈。", "認証トークンは24時間で失効する。", "次の文脈。"]
    rows = []
    for i, b in enumerate(bodies):
        c = Chunk(document_id=doc.id, ordinal=i, heading_path="認証", page_start=0,
                  page_end=0, block_type="text", token_len=len(b), text=b)
        session.add(c); session.flush(); rows.append(c)
    session.commit()
    store.upsert([
        {"chunk_id": c.id, "document_id": doc.id, "owner_user_id": "u1",
         "heading_path": "認証", "page_start": 0, "page_end": 0, "block_type": "text",
         "source_type": "doc", "text": c.text, "vector": e.embed([c.text])[0]}
        for c in rows
    ])

    events = list(retrieve_stream(session, store, e, r, query="認証トークン 失効",
                                  owner_user_id="u1", top_k=1, candidate_k=10))
    stages = [ev["stage"] for ev in events]
    assert stages == ["embed", "embed", "vector_search", "bm25_search",
                      "vector_search", "bm25_search", "rerank", "rerank",
                      "expand", "expand", "result"]
    result_ev = events[-1]
    assert result_ev["stage"] == "result"
    assert len(result_ev["chunks"]) == 1
    assert "失効する" in result_ev["chunks"][0].text

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit(); session.close()
```

> 注: vector_search/bm25_search は「両方 start → 両方 done」の順で出る（並行投入のため start を先に2件、done を2件）。

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd rag && uv run pytest tests/test_retrieval_service.py::test_retrieve_stream_emits_stages_in_order -v`
Expected: FAIL（`ImportError: cannot import name 'retrieve_stream'`）

- [ ] **Step 3: 最小実装**

`rag/app/retrieval/service.py` を以下で全置換:

```python
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.models import Chunk, Document
from app.reranker.base import Reranker
from app.schemas import RetrievedChunk
from app.vectorstore.qdrant import QdrantStore


def _expand(session: Session, document_id: str, ordinal: int) -> str:
    rows = (session.query(Chunk)
            .filter(Chunk.document_id == document_id,
                    Chunk.ordinal.in_([ordinal - 1, ordinal, ordinal + 1]))
            .order_by(Chunk.ordinal).all())
    return "\n\n".join(r.text for r in rows) if rows else ""


def _merge_round_robin(dense: list[dict], sparse: list[dict], limit: int) -> list[dict]:
    # dense/sparse の各ランクを交互に取り chunk_id で重複除去、limit 件で打ち切る。
    seen: set[str] = set()
    out: list[dict] = []
    for i in range(max(len(dense), len(sparse))):
        for src in (dense, sparse):
            if i < len(src):
                cid = src[i]["chunk_id"]
                if cid not in seen:
                    seen.add(cid)
                    out.append(src[i])
                    if len(out) >= limit:
                        return out
    return out


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def retrieve_stream(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
                    *, query: str, owner_user_id: str, top_k: int = 6,
                    candidate_k: int = 40) -> Iterator[dict]:
    # 1) embed（1回の呼び出しで dense+sparse の両方を得る）
    yield {"stage": "embed", "status": "start"}
    t = time.perf_counter()
    qv = embedder.embed([query])[0]
    yield {"stage": "embed", "status": "done", "ms": _ms(t)}

    # 2) dense / sparse 検索を並行実行（性能大前提）。両 start を先に出す。
    yield {"stage": "vector_search", "status": "start"}
    yield {"stage": "bm25_search", "status": "start"}
    with ThreadPoolExecutor(max_workers=2) as ex:
        t0 = time.perf_counter()
        f_dense = ex.submit(store.dense_search, qv.dense, owner_user_id, candidate_k)
        f_sparse = ex.submit(store.sparse_search, qv.sparse, owner_user_id, candidate_k)
        dense_hits = f_dense.result()
        yield {"stage": "vector_search", "status": "done", "ms": _ms(t0), "count": len(dense_hits)}
        sparse_hits = f_sparse.result()
        yield {"stage": "bm25_search", "status": "done", "ms": _ms(t0), "count": len(sparse_hits)}

    if not dense_hits and not sparse_hits:
        yield {"stage": "rerank", "status": "start"}
        yield {"stage": "rerank", "status": "done", "ms": 0, "count": 0}
        yield {"stage": "expand", "status": "start"}
        yield {"stage": "expand", "status": "done", "ms": 0}
        yield {"stage": "result", "chunks": []}
        return

    # 3) round-robin マージ + candidate_k 打ち切り
    merged = _merge_round_robin(dense_hits, sparse_hits, candidate_k)

    # 4) rerank
    yield {"stage": "rerank", "status": "start"}
    tr = time.perf_counter()
    scores = reranker.score(query, [h["text"] for h in merged])
    ranked = sorted(zip(merged, scores), key=lambda x: x[1], reverse=True)[:top_k]
    yield {"stage": "rerank", "status": "done", "ms": _ms(tr), "count": len(ranked)}

    # 5) expand + RetrievedChunk 構築
    yield {"stage": "expand", "status": "start"}
    te = time.perf_counter()
    title_cache: dict[str, str] = {}
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
    yield {"stage": "expand", "status": "done", "ms": _ms(te)}
    yield {"stage": "result", "chunks": out}


def retrieve(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
             *, query: str, owner_user_id: str, top_k: int = 6,
             candidate_k: int = 40) -> list[RetrievedChunk]:
    # 非ストリーミング用 drain ラッパ（既存 /retrieve と既存テストを温存）。
    result: list[RetrievedChunk] = []
    for ev in retrieve_stream(session, store, embedder, reranker, query=query,
                              owner_user_id=owner_user_id, top_k=top_k, candidate_k=candidate_k):
        if ev.get("stage") == "result":
            result = ev["chunks"]
    return result
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_retrieval_service.py -v`
Expected: PASS（新テスト + 既存 `test_retrieve_reranks_and_expands_neighbors` の両方）

- [ ] **Step 5: コミット**

```bash
git add rag/app/retrieval/service.py rag/tests/test_retrieval_service.py
git commit -m "feat: retrieve を段階イベント yield のジェネレータ化し検索を並行実行"
```

---

## Task 3: /retrieve/stream NDJSON エンドポイント

**Files:**
- Modify: `rag/app/routers/retrieve.py`
- Modify: `rag/tests/test_retrieve_api.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_retrieve_api.py` に追記:

```python
import json
from app.retrieval import service as retrieval_service


def test_retrieve_stream_emits_ndjson(monkeypatch):
    def fake_stream(*args, **kwargs):
        yield {"stage": "embed", "status": "done", "ms": 1}
        yield {"stage": "vector_search", "status": "done", "ms": 2, "count": 3}
        yield {"stage": "result", "chunks": [RetrievedChunk(
            chunk_id="c1", document_id="d1", document_title="t", heading_path="H",
            page_start=0, page_end=0, block_type="text", text="b", expanded_text="e", score=0.9)]}
    monkeypatch.setattr(retrieve_router, "retrieve_stream", fake_stream)
    client = TestClient(app)
    res = client.post("/retrieve/stream", headers={"x-internal-token": settings.rag_internal_token},
                      json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 200
    lines = [json.loads(l) for l in res.text.splitlines() if l.strip()]
    assert lines[0] == {"stage": "embed", "status": "done", "ms": 1}
    assert lines[-1]["stage"] == "result"
    assert lines[-1]["chunks"][0]["chunk_id"] == "c1"


def test_retrieve_stream_requires_token():
    client = TestClient(app)
    res = client.post("/retrieve/stream", json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 401
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd rag && uv run pytest tests/test_retrieve_api.py::test_retrieve_stream_emits_ndjson -v`
Expected: FAIL（404 Not Found — エンドポイント未定義）

- [ ] **Step 3: 最小実装**

`rag/app/routers/retrieve.py` を以下で全置換:

```python
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.db import SessionLocal
from app.embedding.factory import get_embedder
from app.reranker.factory import get_reranker
from app.retrieval.service import retrieve as run_retrieve_service
from app.retrieval.service import retrieve_stream
from app.schemas import RetrieveRequest, RetrieveResponse, RetrievedChunk
from app.security import require_internal_token
from app.vectorstore.qdrant import QdrantStore

router = APIRouter()


def _run_retrieve(req: RetrieveRequest) -> list[RetrievedChunk]:
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=getattr(embedder, "dim", 1024))
        return run_retrieve_service(
            session, store, embedder, get_reranker(),
            query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
            top_k=req.top_k, candidate_k=req.candidate_k)
    finally:
        session.close()


@router.post("/retrieve", response_model=RetrieveResponse,
             dependencies=[Depends(require_internal_token)])
def retrieve_endpoint(req: RetrieveRequest):
    return RetrieveResponse(chunks=_run_retrieve(req))


def _stream_ndjson(req: RetrieveRequest):
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=getattr(embedder, "dim", 1024))
        for ev in retrieve_stream(
                session, store, embedder, get_reranker(),
                query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
                top_k=req.top_k, candidate_k=req.candidate_k):
            if ev.get("stage") == "result":
                payload = {"stage": "result", "chunks": [c.model_dump() for c in ev["chunks"]]}
            else:
                payload = ev
            yield json.dumps(payload, ensure_ascii=False) + "\n"
    finally:
        session.close()


@router.post("/retrieve/stream", dependencies=[Depends(require_internal_token)])
def retrieve_stream_endpoint(req: RetrieveRequest):
    return StreamingResponse(_stream_ndjson(req), media_type="application/x-ndjson")
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_retrieve_api.py -v`
Expected: PASS（4 テストすべて）

- [ ] **Step 5: コミット**

```bash
git add rag/app/routers/retrieve.py rag/tests/test_retrieve_api.py
git commit -m "feat: /retrieve/stream で検索段階を NDJSON 配信"
```

---

## Task 4: 型定義に embed/expand と parentId を追加

**Files:**
- Modify: `src/lib/types.ts:31-59`

- [ ] **Step 1: ToolName と ToolCall を更新**

`src/lib/types.ts` の `ToolName`（`types.ts:31-42`）に `embed` と `expand` を追加:

```typescript
export type ToolName =
  | "rewrite_query"
  | "retrieve"
  | "embed"
  | "vector_search"
  | "bm25_search"
  | "rerank"
  | "expand"
  | "fetch_document"
  | "summarize"
  | "answer"
  | "web_search"
  | "python_sandbox"
  | "sql_query";
```

`ToolCall`（`types.ts:50-59`）に `parentId` を追加:

```typescript
export interface ToolCall {
  id: string;
  name: ToolName;
  parentId?: string;
  label: string;
  status: ToolStatus;
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  summary: string;
}
```

- [ ] **Step 2: 型エラーが無いことを確認**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし（追加のみのため既存コードは影響なし）

- [ ] **Step 3: コミット**

```bash
git add src/lib/types.ts
git commit -m "feat: ToolName にサブステージ名を追加し ToolCall に parentId を導入"
```

---

## Task 5: StepBus（サイドチャネルの async キュー）

**Files:**
- Create: `src/lib/agent/step-bus.ts`
- Create: `src/lib/agent/step-bus.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/step-bus.test.ts`:

```typescript
import { expect, test } from "vitest";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent } from "@/lib/types";

const ev = (text: string): AgentEvent => ({ type: "answer-delta", text });

test("drains pushed events in order then ends on close", async () => {
  const bus = new StepBus();
  bus.push(ev("a"));
  bus.push(ev("b"));
  bus.close();
  const got: string[] = [];
  for await (const e of bus) if (e.type === "answer-delta") got.push(e.text);
  expect(got).toEqual(["a", "b"]);
});

test("delivers events pushed after the consumer started waiting", async () => {
  const bus = new StepBus();
  const got: string[] = [];
  const drain = (async () => {
    for await (const e of bus) if (e.type === "answer-delta") got.push(e.text);
  })();
  // consumer is now awaiting; push asynchronously then close.
  await Promise.resolve();
  bus.push(ev("x"));
  bus.push(ev("y"));
  bus.close();
  await drain;
  expect(got).toEqual(["x", "y"]);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm exec vitest run src/lib/agent/step-bus.test.ts`
Expected: FAIL（`Cannot find module step-bus`）

- [ ] **Step 3: 最小実装**

`src/lib/agent/step-bus.ts`:

```typescript
import type { AgentEvent } from "@/lib/types";

/** ツール execute と runAgent ジェネレータをつなぐ単一消費者向け async キュー。
 *  push された順に drain し、close で終端する。 */
export class StepBus {
  private queue: AgentEvent[] = [];
  private waiting: ((r: IteratorResult<AgentEvent>) => void)[] = [];
  private closed = false;

  push(event: AgentEvent): void {
    if (this.closed) return;
    const w = this.waiting.shift();
    if (w) w({ value: event, done: false });
    else this.queue.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let w: ((r: IteratorResult<AgentEvent>) => void) | undefined;
    while ((w = this.waiting.shift())) w({ value: undefined as never, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const r = await new Promise<IteratorResult<AgentEvent>>((resolve) => this.waiting.push(resolve));
      if (r.done) return;
      yield r.value;
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/lib/agent/step-bus.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/step-bus.ts src/lib/agent/step-bus.test.ts
git commit -m "feat: サブステップ配信用 StepBus を追加"
```

---

## Task 6: retrieve-client に retrieveChunksStream を追加

**Files:**
- Modify: `src/lib/agent/retrieve-client.ts`
- Modify: `src/lib/agent/retrieve-client.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/retrieve-client.test.ts` に追記:

```typescript
import { retrieveChunksStream, type RetrieveStageEvent } from "@/lib/agent/retrieve-client";

test("retrieveChunksStream parses NDJSON: forwards stages and returns result chunks", async () => {
  const ndjson =
    '{"stage":"embed","status":"done","ms":1}\n' +
    '{"stage":"vector_search","status":"done","ms":2,"count":3}\n' +
    '{"stage":"result","chunks":[{"chunk_id":"c1","document_id":"d1","document_title":"t",' +
    '"heading_path":"H","page_start":0,"page_end":0,"block_type":"text","text":"b",' +
    '"expanded_text":"e","score":0.9}]}\n';
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(ndjson, { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const stages: RetrieveStageEvent[] = [];
  const chunks = await retrieveChunksStream({
    query: "q", ownerUserId: "u1", topK: 6, onStage: (e) => stages.push(e),
  });

  expect(stages.map((s) => s.stage)).toEqual(["embed", "vector_search"]);
  expect(stages[1].count).toBe(3);
  expect(chunks[0].chunkId).toBe("c1");
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm exec vitest run src/lib/agent/retrieve-client.test.ts`
Expected: FAIL（`retrieveChunksStream` 未エクスポート）

- [ ] **Step 3: 最小実装**

`src/lib/agent/retrieve-client.ts` の `retrieveChunks`（`retrieve-client.ts:16-49`）を以下で置換し、共有 `mapChunk` と `retrieveChunksStream` を追加:

```typescript
function mapChunk(c: Record<string, unknown>): RetrievedChunk {
  return {
    chunkId: c.chunk_id as string,
    documentId: c.document_id as string,
    documentTitle: c.document_title as string,
    headingPath: c.heading_path as string,
    pageStart: c.page_start as number,
    pageEnd: c.page_end as number,
    blockType: c.block_type as string,
    text: c.text as string,
    expandedText: c.expanded_text as string,
    score: c.score as number,
  };
}

export async function retrieveChunks(input: {
  query: string;
  rewritten?: string;
  ownerUserId: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const res = await ragFetch("/retrieve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      rewritten: input.rewritten ?? null,
      owner_user_id: input.ownerUserId,
      top_k: input.topK ?? 6,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`retrieve failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { chunks: Array<Record<string, unknown>> };
  return data.chunks.map(mapChunk);
}

export interface RetrieveStageEvent {
  stage: string;
  status: "start" | "done" | "error";
  ms?: number;
  count?: number;
  message?: string;
}

/** /retrieve/stream を読み、段階イベントを onStage に流し、最終 result の chunks を返す。 */
export async function retrieveChunksStream(input: {
  query: string;
  rewritten?: string;
  ownerUserId: string;
  topK?: number;
  onStage: (ev: RetrieveStageEvent) => void;
}): Promise<RetrievedChunk[]> {
  const res = await ragFetch("/retrieve/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      rewritten: input.rewritten ?? null,
      owner_user_id: input.ownerUserId,
      top_k: input.topK ?? 6,
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`retrieve stream failed: ${res.status} ${body}`);
  }

  let chunks: RetrievedChunk[] = [];
  const handleLine = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    const ev = JSON.parse(s) as Record<string, unknown>;
    if (ev.stage === "result") {
      chunks = (ev.chunks as Array<Record<string, unknown>>).map(mapChunk);
    } else {
      input.onStage(ev as unknown as RetrieveStageEvent);
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer.trim()) handleLine(buffer);
  return chunks;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/lib/agent/retrieve-client.test.ts`
Expected: PASS（既存 2 テスト + 新テスト）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/retrieve-client.ts src/lib/agent/retrieve-client.test.ts
git commit -m "feat: retrieveChunksStream で検索段階の NDJSON を消費"
```

---

## Task 7: retrieve ツールを stream 化しサブステップを push

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Modify: `src/lib/agent/tools.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/tools.test.ts` の先頭 mock を、`retrieveChunksStream` を含むよう更新（既存 `retrieveChunks` mock に追記）:

```typescript
vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(),
  retrieveChunksStream: vi.fn(async ({ onStage }: { onStage: (e: { stage: string; status: string; ms?: number; count?: number }) => void }) => {
    onStage({ stage: "embed", status: "start" });
    onStage({ stage: "embed", status: "done", ms: 1 });
    onStage({ stage: "vector_search", status: "done", ms: 2, count: 3 });
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

その後、新テストを追記（`buildTools` が `bus` を受け取り、サブステップを push することを検証）:

```typescript
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent } from "@/lib/types";

test("retrieve tool pushes nested sub-steps with parentId to the bus", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const bus = new StepBus();
  const events: AgentEvent[] = [];
  const drain = (async () => { for await (const e of bus) events.push(e); })();

  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus });
  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);
  bus.close();
  await drain;

  const subSteps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step");
  expect(subSteps.every((e) => e.step.parentId === "call-1")).toBe(true);
  expect(subSteps.map((e) => e.step.name)).toContain("vector_search");
  const vsDone = subSteps.find((e) => e.step.name === "vector_search" && e.step.status === "done");
  expect(vsDone!.step.output).toMatchObject({ count: 3 });
});
```

既存テストの `buildTools({ registry, ownerUserId, meta })` 呼び出しは、`meta` の後に `bus: new StepBus()` を渡すよう全て更新する。

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm exec vitest run src/lib/agent/tools.test.ts`
Expected: FAIL（`buildTools` が `bus` を要求せず、サブステップが push されない）

- [ ] **Step 3: 最小実装**

`src/lib/agent/tools.ts` を以下で全置換:

```typescript
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { retrieveChunksStream, fetchDocument, type RetrieveStageEvent } from "@/lib/agent/retrieve-client";
import { CitationRegistry } from "@/lib/agent/citations";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent, ToolName } from "@/lib/types";

/** toolCallId -> UI 用メタ。fullStream の tool-call/tool-result に対応付ける。 */
export interface ToolCallMeta {
  name: "retrieve" | "fetch_document";
  input: Record<string, unknown>;
  summary: string;
}

export interface BuildToolsInput {
  registry: CitationRegistry;
  ownerUserId: string;
  meta: Map<string, ToolCallMeta>;
  bus: StepBus;
}

const RETRIEVE_TOP_K = 6;

const STAGE_LABEL: Record<string, string> = {
  embed: "クエリ埋め込み",
  vector_search: "ベクトル検索",
  bm25_search: "キーワード検索",
  rerank: "リランキング",
  expand: "近傍拡張",
};

function stageRunningSummary(stage: string): string {
  switch (stage) {
    case "embed": return "クエリを埋め込み中…";
    case "vector_search": return "密ベクトル検索中…";
    case "bm25_search": return "キーワード検索中…";
    case "rerank": return "再順位付け中…";
    case "expand": return "近傍チャンクを取得中…";
    default: return "実行中…";
  }
}

function stageDoneSummary(stage: string, count?: number): string {
  switch (stage) {
    case "embed": return "クエリを埋め込み";
    case "vector_search": return `密ベクトル ${count ?? 0} 件`;
    case "bm25_search": return `BM25 ${count ?? 0} 件`;
    case "rerank": return `${count ?? 0} 件に再順位付け`;
    case "expand": return "近傍拡張";
    default: return "完了";
  }
}

/** retrieve の段階イベントを parentId 付きサブステップへ変換して bus に流す。 */
function stageToEvent(ev: RetrieveStageEvent, parentId: string): AgentEvent {
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
    return { type: "step", step: { ...base, status: "error", durationMs: 0, input: {}, output: { error: ev.message ?? "失敗" }, summary: "段階に失敗" } };
  }
  return { type: "step", step: { ...base, status: "done", durationMs: ev.ms ?? 0, input: {}, output: ev.count != null ? { count: ev.count } : null, summary: stageDoneSummary(ev.stage, ev.count) } };
}

export function buildTools({ registry, ownerUserId, meta, bus }: BuildToolsInput): ToolSet {
  return {
    retrieve: tool({
      description:
        "社内ナレッジから関連箇所を検索する。ユーザーの質問に答えるために必要な事実を集めるとき、" +
        "また会話の文脈を踏まえた具体的なクエリで何度でも呼べる。" +
        "各ヒットの先頭に付く [n] が出典番号で、深掘りしたいときはその番号を fetch_document に渡す。",
      inputSchema: z.object({
        query: z.string().describe("検索クエリ（会話文脈を解決した自己完結な日本語）"),
      }),
      execute: async ({ query }, { toolCallId }) => {
        const chunks = await retrieveChunksStream({
          query, ownerUserId, topK: RETRIEVE_TOP_K,
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId)),
        });
        const lines = chunks.map((c) => {
          const n = registry.register({
            documentId: c.documentId, documentTitle: c.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: c.text,
          });
          return `[${n}] ${c.documentTitle} — ${c.headingPath}\n${c.expandedText || c.text}`;
        });
        meta.set(toolCallId, { name: "retrieve", input: { query },
          summary: `「${query}」→ ${chunks.length} 件` });
        return lines.length ? lines.join("\n\n") : "該当する資料は見つかりませんでした。";
      },
    }),
    fetch_document: tool({
      description:
        "retrieve でヒットした文書の周辺本文を取得して深掘りする。" +
        "retrieve 結果に付いた出典番号 [n] の数値だけを ref に渡す（UUID は不要）。",
      inputSchema: z.object({
        ref: z.number().int().describe("retrieve 結果の出典番号 [n] の数値（例: 1）"),
      }),
      execute: async ({ ref }, { toolCallId }) => {
        const hit = registry.resolve(ref);
        if (!hit) {
          meta.set(toolCallId, { name: "fetch_document", input: { ref },
            summary: `出典 [${ref}] は未取得` });
          return `出典 [${ref}] はまだ取得していません。先に retrieve を実行し、結果に付いた番号を指定してください。`;
        }
        const doc = await fetchDocument({
          documentId: hit.documentId, ownerUserId, aroundChunkId: hit.chunkId });
        const lines = doc.chunks.map((c) => {
          const n = registry.register({
            documentId: doc.documentId, documentTitle: doc.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: c.text,
          });
          return `[${n}] ${doc.documentTitle} — ${c.headingPath}\n${c.text}`;
        });
        meta.set(toolCallId, { name: "fetch_document",
          input: { ref, document: doc.documentTitle },
          summary: `${doc.documentTitle} → ${doc.chunks.length} 段` });
        return lines.length ? lines.join("\n\n") : "文書の本文が取得できませんでした。";
      },
    }),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/lib/agent/tools.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/tools.ts src/lib/agent/tools.test.ts
git commit -m "feat: retrieve ツールを stream 化しサブステップを bus へ配信"
```

---

## Task 8: run.ts を pump + bus drain へ再構成し rewrite_query を追加

**Files:**
- Modify: `src/lib/agent/run.ts`
- Modify: `src/lib/agent/run.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/run.test.ts` の `retrieve-client` mock を `retrieveChunksStream` 対応に更新:

```typescript
vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(),
  retrieveChunksStream: vi.fn(async ({ onStage }: { onStage: (e: { stage: string; status: string; ms?: number; count?: number }) => void }) => {
    onStage({ stage: "embed", status: "done", ms: 1 });
    onStage({ stage: "vector_search", status: "done", ms: 2, count: 3 });
    return [{
      chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
      pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
      expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
    }];
  }),
  fetchDocument: vi.fn(),
}));
```

`streamText` mock 内の execute 呼び出しはそのまま（execute が onStage を発火する）。新テストを追記:

```typescript
test("runAgent emits rewrite_query sibling and nested retrieve sub-steps", async () => {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }
  const steps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step");

  // rewrite_query はトップレベル（parentId なし）で retrieve より前に出る。
  const rw = steps.find((e) => e.step.name === "rewrite_query");
  expect(rw).toBeDefined();
  expect(rw!.step.parentId).toBeUndefined();
  const rwIdx = steps.findIndex((e) => e.step.name === "rewrite_query");
  const retrIdx = steps.findIndex((e) => e.step.name === "retrieve");
  expect(rwIdx).toBeLessThan(retrIdx);

  // vector_search は retrieve の子（parentId === retrieve の toolCallId = "call-1"）。
  const vs = steps.find((e) => e.step.name === "vector_search");
  expect(vs!.step.parentId).toBe("call-1");
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm exec vitest run src/lib/agent/run.test.ts`
Expected: FAIL（rewrite_query / サブステップが emit されない）

- [ ] **Step 3: 最小実装**

`src/lib/agent/run.ts` を以下で全置換:

```typescript
/** Server-side agentic orchestrator (real backend).
 *
 * 1つのモデルに retrieve / fetch_document を渡し stopWhen でループ。
 * fullStream のパーツと、retrieve ツールが StepBus に流すサブステップを
 * 統合して AgentEvent として yield する。引用は CitationRegistry で番号統合。 */

import { streamText, stepCountIs, type LanguageModelUsage, type ModelMessage } from "ai";
import { resolveModels, DEFAULT_MODEL_ID } from "@/lib/agent/models";
import { buildTools, type ToolCallMeta } from "@/lib/agent/tools";
import { CitationRegistry } from "@/lib/agent/citations";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent, ToolCall, ToolName } from "@/lib/types";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  history?: ModelMessage[];
  attachments?: string[];
  modelId?: string;
}

const SYSTEM =
  "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
  "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
  "回答は提供された一次資料のみに基づき日本語で簡潔に行い、重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付け、" +
  "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。資料に無いことは推測しないでください。";

const MAX_STEPS = 6;

export async function* runAgent(input: RunInput): AsyncGenerator<AgentEvent> {
  const bus = new StepBus();
  // pump は drain と並行に走らせる（await しない）。完了時に必ず bus.close()。
  void pump(input, bus);
  for await (const ev of bus) yield ev;
}

async function pump(
  { query, ownerUserId, threadId, history, modelId }: RunInput,
  bus: StepBus,
): Promise<void> {
  const started = Date.now();
  const modelLabel = modelId ?? DEFAULT_MODEL_ID;
  const resolution = resolveModels(modelId);

  // キー未設定: 検索も生成もできないため理由を返して終了。
  if (!resolution.ok) {
    bus.push({ type: "answer-start" });
    bus.push({ type: "answer-delta", text: resolution.reason });
    bus.push({ type: "done", tokens: 0, durationMs: Date.now() - started,
              citationMap: {}, sourceIds: [], sources: [], threadId });
    bus.close();
    return;
  }

  const registry = new CitationRegistry();
  const meta = new Map<string, ToolCallMeta>();
  const tools = buildTools({ registry, ownerUserId, meta, bus });

  const messages: ModelMessage[] = [...(history ?? []), { role: "user", content: query }];

  const result = streamText({
    model: resolution.models.chat,
    system: SYSTEM,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const stepStart = new Map<string, number>();
  const stepById = new Map<string, ToolCall>();
  let answerStarted = false;
  let answer = "";
  let answerStepEmitted = false;
  let answerStartT = 0;
  let totalUsage: LanguageModelUsage | undefined;

  const emitAnswerStep = (status: "running" | "done", t: number, usage?: LanguageModelUsage): AgentEvent => ({
    type: "step",
    step: {
      id: "answer", name: "answer" as ToolName, label: "回答生成", status,
      durationMs: status === "done" ? Date.now() - t : 0,
      input: { model: modelLabel },
      output: status === "done"
        ? {
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            totalTokens: usage?.totalTokens ?? null,
            cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
          }
        : null,
      summary: status === "done" ? "回答を生成" : "回答を生成中…",
    },
  });

  try {
    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        // retrieve の直前に rewrite_query をトップレベル兄弟として出す（モデルが送ったクエリの可視化）。
        if (part.toolName === "retrieve") {
          const rewritten = (part.input as { query?: string } | undefined)?.query ?? query;
          bus.push({ type: "step", step: {
            id: `${part.toolCallId}:rewrite`, name: "rewrite_query", label: "クエリ正規化",
            status: "done", durationMs: 0,
            input: { original: query, rewritten },
            output: null, summary: `「${rewritten}」に書き換え`,
          } });
        }
        stepStart.set(part.toolCallId, Date.now());
        const step: ToolCall = {
          id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
          status: "running", durationMs: 0,
          input: (part.input ?? {}) as Record<string, unknown>, output: null,
          summary: runningSummary(part.toolName),
        };
        stepById.set(part.toolCallId, step);
        bus.push({ type: "step", step });
      } else if (part.type === "tool-result") {
        const t0 = stepStart.get(part.toolCallId) ?? Date.now();
        const m = meta.get(part.toolCallId);
        const prev = stepById.get(part.toolCallId);
        const step: ToolCall = {
          id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
          status: "done", durationMs: Date.now() - t0,
          input: prev?.input ?? (m?.input ?? {}),
          output: { result: String(part.output).slice(0, 2000) },
          summary: m?.summary ?? "完了",
        };
        bus.push({ type: "step", step });
      } else if (part.type === "tool-error") {
        const t0 = stepStart.get(part.toolCallId) ?? Date.now();
        bus.push({
          type: "step",
          step: {
            id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
            status: "error", durationMs: Date.now() - t0,
            input: (part.input ?? {}) as Record<string, unknown>,
            output: { error: String(part.error).slice(0, 500) }, summary: "ツール実行に失敗",
          },
        });
      } else if (part.type === "text-delta") {
        if (!answerStarted) {
          answerStarted = true;
          answerStartT = Date.now();
          bus.push(emitAnswerStep("running", answerStartT));
          answerStepEmitted = true;
          bus.push({ type: "answer-start" });
        }
        answer += part.text;
        bus.push({ type: "answer-delta", text: part.text });
      } else if (part.type === "finish") {
        totalUsage = part.totalUsage;
      }
    }
  } catch {
    if (!answer) {
      if (!answerStarted) bus.push({ type: "answer-start" });
      answer = "回答の生成に失敗しました。時間をおいて再度お試しください。";
      bus.push({ type: "answer-delta", text: answer });
    }
  }

  if (!answer) {
    if (!answerStarted) bus.push({ type: "answer-start" });
    answer = registry.size === 0
      ? "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。"
      : "回答を生成できませんでした。時間をおいて再度お試しください。";
    bus.push({ type: "answer-delta", text: answer });
  }

  if (answerStepEmitted) bus.push(emitAnswerStep("done", answerStartT, totalUsage));

  const tokens = totalUsage?.totalTokens ?? totalUsage?.outputTokens ?? Math.max(1, Math.round(answer.length / 1.8));
  const sources = registry.toSources();
  bus.push({
    type: "done",
    tokens,
    durationMs: Date.now() - started,
    citationMap: registry.toCitationMap(),
    sourceIds: sources.map((s) => s.id),
    sources,
    threadId,
  });
  bus.close();
}

function toolLabel(name: string): string {
  if (name === "retrieve") return "知識ベース検索";
  if (name === "fetch_document") return "文書取得";
  return name;
}

function runningSummary(name: string): string {
  if (name === "retrieve") return "知識ベースを検索中…";
  if (name === "fetch_document") return "文書を取得中…";
  return "実行中…";
}

export { DEFAULT_MODEL_ID };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/lib/agent/run.test.ts src/lib/agent/run-fallback.test.ts`
Expected: PASS（既存テスト + 新テスト）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/run.ts src/lib/agent/run.test.ts
git commit -m "feat: runAgent を StepBus 経由に再構成し rewrite_query を追加"
```

---

## Task 9: tool-steps に親子ネスト描画とアイコンを追加

**Files:**
- Modify: `src/components/chat/tool-steps.tsx`

- [ ] **Step 1: 新ステージのアイコンを追加**

`src/components/chat/tool-steps.tsx` の `TOOL_ICONS`（`tool-steps.tsx:6-37`）に `embed` と `expand` を追加（`vector_search`/`bm25_search`/`rerank`/`rewrite_query` は既存定義を流用）。`summarize` の直後に追記:

```typescript
  embed: (
    <>
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </>
  ),
  expand: <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
```

- [ ] **Step 2: 親子グルーピングのヘルパを追加**

`tool-steps.tsx` の `ToolSteps` 直前（`tool-steps.tsx:388` の上）に追加:

```typescript
/** フラットな steps を「ルート(parentId なし)」と「子(parentId 別)」に分ける。 */
function groupSteps(steps: ToolCall[]): { roots: ToolCall[]; childrenOf: Map<string, ToolCall[]> } {
  const roots: ToolCall[] = [];
  const childrenOf = new Map<string, ToolCall[]>();
  for (const s of steps) {
    if (s.parentId) {
      const arr = childrenOf.get(s.parentId) ?? [];
      arr.push(s);
      childrenOf.set(s.parentId, arr);
    } else {
      roots.push(s);
    }
  }
  return { roots, childrenOf };
}

/** 子サブステップのコンパクト行（展開なし）。card / timeline 共通。 */
function SubStepRow({ step }: { step: ToolCall }) {
  return (
    <div className="flex items-center gap-2.5 py-[3px] text-[11.5px] text-fg-2">
      <StatusIcon status={step.status} />
      <span className="grid place-items-center text-muted-2">
        <svg viewBox="0 0 16 16" width="12" height="12">{TOOL_ICONS[step.name]}</svg>
      </span>
      <span className="font-mono text-[11px] font-semibold text-fg-2">{step.name}</span>
      <span className="min-w-0 flex-1 truncate text-muted">{step.summary}</span>
      <span className="font-mono text-[10.5px] tabular-nums text-muted-2">{formatMs(step.durationMs)}</span>
    </div>
  );
}

function SubSteps({ steps }: { steps: ToolCall[] | undefined }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="flex flex-col gap-px border-l-[1.5px] border-divider pl-3 ml-[7px]">
      {steps.map((s) => <SubStepRow key={s.id} step={s} />)}
    </div>
  );
}
```

- [ ] **Step 3: card / timeline / log の各バリアントでネストを描画**

`ToolSteps`（`tool-steps.tsx:388-406`）を以下で置換:

```typescript
export function ToolSteps({ steps, variant, expandedMap, onToggleStep }: Props) {
  if (variant === "log") return <ToolStepLog steps={steps} />;

  const { roots, childrenOf } = groupSteps(steps);

  if (variant === "timeline") {
    return (
      <div className="px-3.5 pb-3 pt-2 max-md:px-3">
        {roots.map((s, i) => (
          <div key={s.id}>
            <ToolStepTimeline step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} isLast={i === roots.length - 1} />
            {childrenOf.has(s.id) && (
              <div className="mb-2 ml-[22px] pl-1">
                <SubSteps steps={childrenOf.get(s.id)} />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {roots.map((s) => (
        <div key={s.id}>
          <ToolStepCard step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} />
          {childrenOf.has(s.id) && (
            <div className="border-b-[0.5px] border-divider bg-surface px-3.5 py-2 pl-10 max-md:pl-6">
              <SubSteps steps={childrenOf.get(s.id)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

`ToolStepLog`（`tool-steps.tsx:340-379`）の `lines.push` で `name` を表示している箇所は、子ステップ（`s.parentId` あり）の場合に字下げするよう、`steps.forEach` 内の先頭で `const indent = s.parentId ? "  " : "";` を定義し、`name: indent + s.name` 相当に `l.name` 表示へ反映（`<span>{l.name}</span>` を `<span>{indent}{l.name}</span>` ではなく、lines 生成時に `name: (s.parentId ? "› " : "") + s.name` とする）。具体的には `lines.push({ ..., name: (s.parentId ? "› " : "") + s.name, ... })` の形に各 push を更新する。

- [ ] **Step 4: 型チェックと既存 UI テストを確認**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/hooks/use-agent-reduce.test.ts`
Expected: エラーなし / PASS（reducer はフラット蓄積のまま変更なし）

- [ ] **Step 5: コミット**

```bash
git add src/components/chat/tool-steps.tsx
git commit -m "feat: ツールステップに親子ネスト描画とサブステージアイコンを追加"
```

---

## Task 10: agent-activity の集計をトップレベルに、現在段階を running leaf に

**Files:**
- Modify: `src/components/chat/agent-activity.tsx:22-26`

- [ ] **Step 1: 集計と current 判定を更新**

`src/components/chat/agent-activity.tsx` の `if (steps.length === 0) return null;` 直後（`agent-activity.tsx:22-25`）を以下で置換:

```typescript
  if (steps.length === 0) return null;

  // 子サブステップの ms は親 retrieve の duration に内包されるため、集計はトップレベルのみ。
  const topLevel = steps.filter((s) => !s.parentId);
  const totalMs = topLevel.reduce((a, s) => a + (s.durationMs || 0), 0);
  // 現在段階インジケータ: running な leaf（子）を優先し、無ければトップレベルの running。
  const runningSteps = steps.filter((s) => s.status === "running");
  const current = runningSteps.find((s) => s.parentId) ?? runningSteps[0];
```

そして「N ステップ」の表示（`agent-activity.tsx:42` の `{steps.length} ステップ`）を `{topLevel.length} ステップ` に変更する。

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: 手動確認用にビルドが通ることを確認**

Run: `pnpm exec vitest run`
Expected: 全テスト PASS

- [ ] **Step 4: コミット**

```bash
git add src/components/chat/agent-activity.tsx
git commit -m "feat: エージェント活動ヘッダをトップレベル集計と現在段階表示に更新"
```

---

## 最終確認

- [ ] **バックエンド全テスト**

Run: `cd rag && uv run pytest -q`
Expected: 全 PASS（削除した test_hybrid_search 以外）

- [ ] **フロント全テスト + 型 + lint**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全 PASS

- [ ] **手動確認（任意）**

rag バックエンドと Next.js を起動し、質問を投げて `retrieve` の下に embed / vector_search / bm25_search / rerank / expand がライブで `running → done` 表示され、`rewrite_query` が retrieve の前に出ること、ヘッダのステップ数・合計時間がトップレベルのみで二重計上していないことを目視確認する。
