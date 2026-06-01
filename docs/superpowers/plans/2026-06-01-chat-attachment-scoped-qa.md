# チャット添付スコープ付き Q&A 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会話ドックの添付ファイルが処理中は送信をブロックし、添付ありのターンでは retrieve を添付文書群に排他スコープして添付内容に確実に回答できるようにする。

**Architecture:** アップロード応答の `documentId` を `StagedFile` に保持し、`startRun → use-agent → /api/chat → runAgent → buildTools → retrieve-client → rag /retrieve` まで `attachmentDocIds` を貫通させる。rag 側は Qdrant フィルタに `document_id` の `MatchAny` を AND する。送信ブロックは `composer.tsx` の純粋ロジック変更のみ。

**Tech Stack:** Next.js (App Router) / TypeScript / Vitest、FastAPI / SQLAlchemy / Qdrant / pytest。

**設計参照:** `docs/superpowers/specs/2026-06-01-chat-attachment-scoped-qa-design.md`

**重要な前提:**
- rag はベイク済み Docker イメージ。rag 変更後は `docker compose up -d --build rag` が必須（[[project_rag_rebuild_required]]）。
- ローカル Postgres は host 5433（[[project_local_postgres_port]]）。
- rag/rag-worker は `HF_HUB_OFFLINE=1` + `TRANSFORMERS_OFFLINE=1`（[[project_hf_offline_required]]）。
- pytest は rag コンテナ内 or ローカル venv で実行（既存テストの実行方法に合わせる）。Next.js テストは `pnpm test`。

---

## ファイル構成

**rag（Python）**
- Modify: `rag/app/vectorstore/qdrant.py` — `_scope_filter` 追加、dense/sparse_search に `document_ids` 引数。
- Modify: `rag/app/retrieval/service.py` — `retrieve`/`retrieve_stream` に `document_ids` 引数を通す。
- Modify: `rag/app/schemas.py` — `RetrieveRequest.document_ids`。
- Modify: `rag/app/routers/retrieve.py` — `req.document_ids` を渡す。
- Test: `rag/tests/test_qdrant_store.py`, `rag/tests/test_retrieval_service.py`。

**Next.js**
- Modify: `src/lib/types.ts` — `StagedFile.documentId`, `Turn.attachmentDocIds`。
- Modify: `src/hooks/use-uploads.ts` — 応答の `documentId` を保持。
- Modify: `src/lib/agent/retrieve-client.ts` — `documentIds` をボディに。
- Modify: `src/lib/agent/tools.ts` — `buildTools` に `attachmentDocIds`。
- Modify: `src/lib/agent/run.ts` — `RunInput` に `attachments`/`attachmentDocIds`、`buildUserContent` ヘルパ、buildTools へ伝播。
- Modify: `src/app/api/chat/route.ts` — destructure & 伝播。
- Modify: `src/hooks/use-agent.ts` — `run` シグネチャ・ボディ・`emptyTurn`/`appendRunTurn`。
- Modify: `src/components/workspace/workspace.tsx` — `startRun` で docIds 収集・伝播。
- Modify: `src/components/chat/composer.tsx` — 送信ブロックロジック + ヒント、`composerSubmitState` ヘルパ。
- Test: `src/lib/agent/retrieve-client.test.ts`, `src/lib/agent/tools.test.ts`, `src/lib/agent/run.test.ts`, `src/components/chat/composer.test.ts`（新規）。

---

## Task 1: Qdrant スコープフィルタに document_ids を追加

**Files:**
- Modify: `rag/app/vectorstore/qdrant.py:51-82`
- Test: `rag/tests/test_qdrant_store.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_qdrant_store.py` の末尾に追記:

```python
_SCOPE_COLL = "test_scope_" + uuid.uuid4().hex[:8]


def test_dense_and_sparse_search_filter_document_ids():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=_SCOPE_COLL, dim=8)
    store.ensure_collection()
    store.upsert([_split_row(e, "添付された設計メモ", owner="u1", doc="docA"),
                  _split_row(e, "別の社内資料", owner="u1", doc="docB")])
    qv = e.embed(["設計メモ"])[0]

    # document_ids=["docA"] でスコープすると docA のチャンクのみ返る
    dense = store.dense_search(qv.dense, owner_user_id="u1", limit=10, document_ids=["docA"])
    sparse = store.sparse_search(qv.sparse, owner_user_id="u1", limit=10, document_ids=["docA"])
    assert len(dense) == 1 and dense[0]["document_id"] == "docA"
    assert len(sparse) == 1 and sparse[0]["document_id"] == "docA"

    # document_ids 未指定なら従来どおり owner 全体（2件）
    dense_all = store.dense_search(qv.dense, owner_user_id="u1", limit=10)
    assert len(dense_all) == 2
    store.drop()
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pytest rag/tests/test_qdrant_store.py::test_dense_and_sparse_search_filter_document_ids -v`
Expected: FAIL（`dense_search() got an unexpected keyword argument 'document_ids'`）

- [ ] **Step 3: 最小実装**

`rag/app/vectorstore/qdrant.py` の `_owner_filter` を `_scope_filter` に置き換え、検索2メソッドへ `document_ids` を追加:

```python
    def _scope_filter(self, owner_user_id: str,
                      document_ids: list[str] | None = None) -> models.Filter:
        must = [models.FieldCondition(
            key="owner_user_id", match=models.MatchValue(value=owner_user_id))]
        if document_ids:
            must.append(models.FieldCondition(
                key="document_id", match=models.MatchAny(any=list(document_ids))))
        return models.Filter(must=must)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def dense_search(self, query_dense: list[float], owner_user_id: str, limit: int = 40,
                     document_ids: list[str] | None = None) -> list[dict]:
        if not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection, query=query_dense, using=DENSE, limit=limit,
            query_filter=self._scope_filter(owner_user_id, document_ids), with_payload=True)
        return self._payloads(res)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def sparse_search(self, query_sparse: dict[int, float], owner_user_id: str, limit: int = 40,
                      document_ids: list[str] | None = None) -> list[dict]:
        if not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection,
            query=models.SparseVector(indices=list(query_sparse.keys()), values=list(query_sparse.values())),
            using=SPARSE, limit=limit,
            query_filter=self._scope_filter(owner_user_id, document_ids), with_payload=True)
        return self._payloads(res)
```

注: `_owner_filter` を参照している箇所が他にないことを確認（`grep -n _owner_filter rag/app`）。あれば `_scope_filter` に置換。

- [ ] **Step 4: テストが通ることを確認**

Run: `pytest rag/tests/test_qdrant_store.py -v`
Expected: PASS（既存の owner フィルタテストも含め全 PASS）

- [ ] **Step 5: コミット**

```bash
git add rag/app/vectorstore/qdrant.py rag/tests/test_qdrant_store.py
git commit -m "feat: Qdrant検索にdocument_idsスコープフィルタを追加"
```

---

## Task 2: retrieval サービスで document_ids を伝播

**Files:**
- Modify: `rag/app/retrieval/service.py:70-95,93-95,166-176`
- Test: `rag/tests/test_retrieval_service.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_retrieval_service.py` の末尾に追記:

```python
def test_retrieve_scopes_to_document_ids():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection="test_scope_svc_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    session = SessionLocal()
    docA = Document(owner_user_id="u1", filename="添付.pdf", mime="application/pdf",
                    size=1, raw_path="/tmp/a", status="ready")
    docB = Document(owner_user_id="u1", filename="他.pdf", mime="application/pdf",
                    size=1, raw_path="/tmp/b", status="ready")
    session.add_all([docA, docB]); session.flush()
    for doc, body in ((docA, "添付の本文。"), (docB, "無関係の本文。")):
        c = Chunk(document_id=doc.id, ordinal=0, heading_path="H", page_start=0,
                  page_end=0, block_type="text", token_len=len(body), text=body)
        session.add(c); session.flush()
        store.upsert([{"chunk_id": c.id, "document_id": doc.id, "owner_user_id": "u1",
                       "heading_path": "H", "page_start": 0, "page_end": 0,
                       "block_type": "text", "source_type": "doc", "text": c.text,
                       "vector": e.embed([c.text])[0]}])
    session.commit()

    res = retrieve(session, store, e, r, query="本文", owner_user_id="u1",
                   top_k=5, candidate_k=10, document_ids=[docA.id])
    assert len(res) == 1
    assert res[0].document_id == docA.id

    store.drop()
    session.query(Chunk).filter(Chunk.document_id.in_([docA.id, docB.id])).delete(synchronize_session=False)
    session.query(Document).filter(Document.id.in_([docA.id, docB.id])).delete(synchronize_session=False)
    session.commit(); session.close()
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pytest rag/tests/test_retrieval_service.py::test_retrieve_scopes_to_document_ids -v`
Expected: FAIL（`retrieve() got an unexpected keyword argument 'document_ids'`）

- [ ] **Step 3: 最小実装**

`rag/app/retrieval/service.py`:

`retrieve_stream` のシグネチャに `document_ids` を追加:

```python
def retrieve_stream(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
                    *, query: str, owner_user_id: str, top_k: int = 6,
                    candidate_k: int = DEFAULT_CANDIDATE_K,
                    document_ids: list[str] | None = None) -> Iterator[dict]:
```

ThreadPoolExecutor の submit を `document_ids` 付きに変更（`_timed` は位置引数を fn にそのまま渡すので末尾に追加）:

```python
        f_dense = ex.submit(_timed, store.dense_search, qv.dense, owner_user_id, candidate_k, document_ids)
        f_sparse = ex.submit(_timed, store.sparse_search, qv.sparse, owner_user_id, candidate_k, document_ids)
```

`retrieve`（drain ラッパ）にも追加して伝播:

```python
def retrieve(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
             *, query: str, owner_user_id: str, top_k: int = 6,
             candidate_k: int = DEFAULT_CANDIDATE_K,
             document_ids: list[str] | None = None) -> list[RetrievedChunk]:
    result: list[RetrievedChunk] = []
    for ev in retrieve_stream(session, store, embedder, reranker, query=query,
                              owner_user_id=owner_user_id, top_k=top_k, candidate_k=candidate_k,
                              document_ids=document_ids):
        if ev.get("stage") == "result":
            result = ev["chunks"]
            break
    return result
```

注: `dense_search`/`sparse_search` の引数は `(query, owner_user_id, limit, document_ids)` の順。`_timed(fn, *args)` は `fn(*args)` を呼ぶため、`store.dense_search, qv.dense, owner_user_id, candidate_k, document_ids` の順で渡せば `limit=candidate_k, document_ids=document_ids` に対応する。

- [ ] **Step 4: テストが通ることを確認**

Run: `pytest rag/tests/test_retrieval_service.py -v`
Expected: PASS（既存テストも全 PASS）

- [ ] **Step 5: コミット**

```bash
git add rag/app/retrieval/service.py rag/tests/test_retrieval_service.py
git commit -m "feat: retrievalサービスでdocument_idsスコープを伝播"
```

---

## Task 3: RetrieveRequest スキーマとルーターで document_ids を受ける

**Files:**
- Modify: `rag/app/schemas.py:34-39`
- Modify: `rag/app/routers/retrieve.py:18-28,37-52`
- Test: `rag/tests/test_retrieve_api.py`

- [ ] **Step 1: 失敗するテストを書く**

既存テストの流儀（`TestClient(app)` を直接生成、トークンは `settings.rag_internal_token`、`_run_retrieve` を `monkeypatch.setattr` で差し替え）に合わせる。`rag/tests/test_retrieve_api.py` の末尾に、`document_ids` がスキーマで受理され `_run_retrieve` に届くことを検証するテストを追記:

```python
def test_retrieve_accepts_document_ids(monkeypatch):
    captured = {}

    def fake_run(req):
        captured["document_ids"] = req.document_ids
        return [RetrievedChunk(chunk_id="c1", document_id="docA", document_title="t",
                               heading_path="H", page_start=0, page_end=0, block_type="text",
                               text="body", expanded_text="exp", score=0.9)]

    monkeypatch.setattr(retrieve_router, "_run_retrieve", fake_run)
    client = TestClient(app)
    res = client.post("/retrieve", headers={"x-internal-token": settings.rag_internal_token},
                      json={"query": "本文", "owner_user_id": "u1",
                            "top_k": 5, "document_ids": ["docA"]})
    assert res.status_code == 200
    assert captured["document_ids"] == ["docA"]
```

注: `RetrievedChunk` は当該ファイル先頭で既に import 済み。`document_ids` 未指定時は `req.document_ids is None` となること（後方互換）は既存の `test_retrieve_returns_chunks` が暗黙にカバーする。

- [ ] **Step 2: テストが失敗することを確認**

Run: `pytest rag/tests/test_retrieve_api.py::test_retrieve_accepts_document_ids -v`
Expected: FAIL（`RetrieveRequest` に `document_ids` が無く `AttributeError: 'RetrieveRequest' object has no attribute 'document_ids'`、または送信フィールドが無視され captured が None）

- [ ] **Step 3: 最小実装**

`rag/app/schemas.py` の `RetrieveRequest` に追加:

```python
class RetrieveRequest(BaseModel):
    query: str
    rewritten: str | None = None
    owner_user_id: str
    top_k: int = Field(default=6, ge=1, le=50)
    candidate_k: int = Field(default=10, ge=1, le=500)
    document_ids: list[str] | None = None
```

`rag/app/routers/retrieve.py` の `_run_retrieve` と `_stream_ndjson` で `document_ids=req.document_ids` を渡す:

```python
        return run_retrieve_service(
            session, store, embedder, get_reranker(),
            query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
            top_k=req.top_k, candidate_k=req.candidate_k,
            document_ids=req.document_ids)
```

```python
        for ev in retrieve_stream(
                session, store, embedder, get_reranker(),
                query=req.rewritten or req.query, owner_user_id=req.owner_user_id,
                top_k=req.top_k, candidate_k=req.candidate_k,
                document_ids=req.document_ids):
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pytest rag/tests/test_retrieve_api.py -v`
Expected: PASS

- [ ] **Step 5: rag を再ビルドして起動**

Run: `docker compose up -d --build rag`
Expected: rag コンテナが healthy になる（`docker compose ps` で確認）。

- [ ] **Step 6: コミット**

```bash
git add rag/app/schemas.py rag/app/routers/retrieve.py rag/tests/test_retrieve_api.py
git commit -m "feat: /retrieve APIでdocument_idsスコープを受け付け"
```

---

## Task 4: retrieve-client が document_ids をボディに載せる

**Files:**
- Modify: `src/lib/agent/retrieve-client.ts:31-55,71-89`
- Test: `src/lib/agent/retrieve-client.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/retrieve-client.test.ts` の末尾に追記:

```typescript
test("retrieveChunksStream sends document_ids when provided", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response('{"stage":"result","chunks":[]}\n', { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  await retrieveChunksStream({
    query: "q", ownerUserId: "u1", topK: 6, documentIds: ["docA", "docB"], onStage: () => {},
  });

  const [, init] = spy.mock.calls[0];
  expect(JSON.parse(init!.body as string).document_ids).toEqual(["docA", "docB"]);
});

test("retrieveChunksStream sends null document_ids by default", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response('{"stage":"result","chunks":[]}\n', { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  await retrieveChunksStream({ query: "q", ownerUserId: "u1", topK: 6, onStage: () => {} });

  const [, init] = spy.mock.calls[0];
  expect(JSON.parse(init!.body as string).document_ids).toBeNull();
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- src/lib/agent/retrieve-client.test.ts`
Expected: FAIL（`document_ids` が undefined → JSON で欠落、`toEqual`/`toBeNull` で失敗）

- [ ] **Step 3: 最小実装**

`src/lib/agent/retrieve-client.ts`:

`retrieveChunks` の入力型とボディに追加:

```typescript
export async function retrieveChunks(input: {
  query: string;
  rewritten?: string;
  ownerUserId: string;
  topK?: number;
  candidateK?: number;
  documentIds?: string[];
}): Promise<RetrievedChunk[]> {
  const res = await ragFetch("/retrieve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      rewritten: input.rewritten ?? null,
      owner_user_id: input.ownerUserId,
      top_k: input.topK ?? 6,
      candidate_k: input.candidateK ?? undefined,
      document_ids: input.documentIds ?? null,
    }),
  });
```

`retrieveChunksStream` の入力型とボディにも同様に追加:

```typescript
export async function retrieveChunksStream(input: {
  query: string;
  rewritten?: string;
  ownerUserId: string;
  topK?: number;
  candidateK?: number;
  documentIds?: string[];
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
      candidate_k: input.candidateK ?? undefined,
      document_ids: input.documentIds ?? null,
    }),
  });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- src/lib/agent/retrieve-client.test.ts`
Expected: PASS（既存テストも全 PASS）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/retrieve-client.ts src/lib/agent/retrieve-client.test.ts
git commit -m "feat: retrieve-clientでdocument_idsを送信"
```

---

## Task 5: buildTools が attachmentDocIds を retrieve に渡す

**Files:**
- Modify: `src/lib/agent/tools.ts:16-21,97-133`
- Test: `src/lib/agent/tools.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/tools.test.ts` の末尾に追記:

```typescript
test("retrieve tool scopes to attachmentDocIds when provided", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus(),
    attachmentDocIds: ["docA", "docB"] });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-scope", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ documentIds: ["docA", "docB"] }));
});

test("retrieve tool passes undefined documentIds without attachments", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta, bus: new StepBus() });

  await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-noscope", messages: [] } as never);

  expect(vi.mocked(retrieveChunksStream)).toHaveBeenLastCalledWith(
    expect.objectContaining({ documentIds: undefined }));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- src/lib/agent/tools.test.ts`
Expected: FAIL（`documentIds` が retrieveChunksStream に渡っていない）

- [ ] **Step 3: 最小実装**

`src/lib/agent/tools.ts` の `BuildToolsInput` に追加:

```typescript
export interface BuildToolsInput {
  registry: CitationRegistry;
  ownerUserId: string;
  meta: Map<string, ToolCallMeta>;
  bus: StepBus;
  /** 添付ありターンでは retrieve をこの文書群に排他スコープする。空/未指定なら全体検索。 */
  attachmentDocIds?: string[];
}
```

`buildTools` の destructure と retrieve 呼び出しを変更:

```typescript
export function buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds }: BuildToolsInput): ToolSet {
```

```typescript
      execute: async ({ query }, { toolCallId }) => {
        const chunks = await retrieveChunksStream({
          query, ownerUserId, topK: RETRIEVE_TOP_K, candidateK: RETRIEVE_CANDIDATE_K,
          documentIds: attachmentDocIds && attachmentDocIds.length ? attachmentDocIds : undefined,
          onStage: (ev) => bus.push(stageToEvent(ev, toolCallId, query)),
        });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- src/lib/agent/tools.test.ts`
Expected: PASS（既存テストも全 PASS）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/tools.ts src/lib/agent/tools.test.ts
git commit -m "feat: buildToolsで添付文書スコープをretrieveへ伝播"
```

---

## Task 6: run.ts で添付文脈を組み立て、buildTools へ伝播

**Files:**
- Modify: `src/lib/agent/run.ts:14-21,31-36,38-41,58-62`
- Test: `src/lib/agent/run.test.ts`

- [ ] **Step 1: 失敗するテストを書く（純粋ヘルパ buildUserContent）**

`src/lib/agent/run.test.ts` の末尾に追記（既存の import 行に `buildUserContent` を足す: `import { runAgent, buildUserContent } from "@/lib/agent/run";` ※現状の import 文を確認して合わせる）:

```typescript
test("buildUserContent prepends attachment names when docIds present", () => {
  const out = buildUserContent("これ何？", ["a.json", "b.pdf"], ["docA", "docB"]);
  expect(out).toBe("[添付ファイル: a.json、b.pdf]\nこれ何？");
});

test("buildUserContent returns plain query when no attachment docIds", () => {
  expect(buildUserContent("通常の質問", [], [])).toBe("通常の質問");
  expect(buildUserContent("通常の質問", ["a.json"], [])).toBe("通常の質問");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- src/lib/agent/run.test.ts`
Expected: FAIL（`buildUserContent` is not exported / not a function）

- [ ] **Step 3: 最小実装**

`src/lib/agent/run.ts`:

`RunInput` に `attachments` を確実に持たせ、`attachmentDocIds` を追加:

```typescript
export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  history?: ModelMessage[];
  attachments?: string[];
  attachmentDocIds?: string[];
  modelId?: string;
}
```

純粋ヘルパを追加（ファイル下部、`toolLabel` 付近に export）:

```typescript
/** 添付ありターンでは user メッセージ先頭に添付名の文脈を付け、曖昧な質問でも添付を解決させる。 */
export function buildUserContent(query: string, attachments: string[], attachmentDocIds: string[]): string {
  if (attachmentDocIds.length && attachments.length) {
    return `[添付ファイル: ${attachments.join("、")}]\n${query}`;
  }
  return query;
}
```

`pump` の destructure に `attachments`/`attachmentDocIds` を追加し、messages 構築と buildTools 呼び出しに反映:

```typescript
async function pump(
  { query, ownerUserId, threadId, history, modelId, attachments, attachmentDocIds }: RunInput,
  bus: StepBus,
): Promise<void> {
```

```typescript
    const tools = buildTools({ registry, ownerUserId, meta, bus, attachmentDocIds });

    const userContent = buildUserContent(query, attachments ?? [], attachmentDocIds ?? []);
    const messages: ModelMessage[] = [...(history ?? []), { role: "user", content: userContent }];
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- src/lib/agent/run.test.ts`
Expected: PASS（既存の runAgent テストも全 PASS）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/run.ts src/lib/agent/run.test.ts
git commit -m "feat: runAgentで添付文脈の注入とスコープ伝播"
```

---

## Task 7: /api/chat ルートで attachments / attachmentDocIds を受け渡す

**Files:**
- Modify: `src/app/api/chat/route.ts:16-18,53`

- [ ] **Step 1: 実装（ボディ destructure と runAgent への伝播）**

`src/app/api/chat/route.ts` のボディ取得を変更:

```typescript
  const { query, threadId, model, regenerateFrom, attachments, attachmentDocIds } =
    (await req.json().catch(() => ({}))) as {
      query?: string; threadId?: string; model?: string; regenerateFrom?: number;
      attachments?: string[]; attachmentDocIds?: string[];
    };
```

`runAgent` 呼び出しに追加:

```typescript
        for await (const event of runAgent({
          query: q, ownerUserId: claims.sub, threadId: tid, modelId: model, history,
          attachments, attachmentDocIds,
        })) {
```

- [ ] **Step 2: 型チェックとビルド確認**

Run: `pnpm tsc --noEmit`
Expected: エラーなし（`runAgent` の `RunInput` に両プロパティが定義済み）

- [ ] **Step 3: コミット**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: /api/chatで添付情報をrunAgentへ受け渡し"
```

---

## Task 8: types に documentId / attachmentDocIds を追加

**Files:**
- Modify: `src/lib/types.ts:85-97,154-174`

- [ ] **Step 1: 実装（型追加）**

`src/lib/types.ts` の `Turn` に追加（`attachments: string[];` の直後）:

```typescript
  attachments: string[];
  /** 添付の documentId（添付ありターンの retrieve スコープ・再生成再利用に使う。in-memory のみ）。 */
  attachmentDocIds?: string[];
```

`StagedFile` に追加（`jobId?: string;` の付近）:

```typescript
  jobId?: string;
  /** アップロード応答で確定する rag 側 documentId（添付スコープ検索に使う）。 */
  documentId?: string;
```

- [ ] **Step 2: 型チェック確認**

Run: `pnpm tsc --noEmit`
Expected: エラーなし（追加は任意プロパティで後方互換）

- [ ] **Step 3: コミット**

```bash
git add src/lib/types.ts
git commit -m "feat: StagedFileとTurnに添付documentIdを追加"
```

---

## Task 9: use-uploads が応答の documentId を保持

**Files:**
- Modify: `src/hooks/use-uploads.ts:195-196`

- [ ] **Step 1: 実装（documentId を StagedFile に保持）**

`src/hooks/use-uploads.ts` の応答処理を変更:

```typescript
            const { documentId, jobId } = (await res.json()) as { documentId: string; jobId: string };
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 10, jobId, documentId } : f)));
            startStreaming(id, jobId, file.name);
```

- [ ] **Step 2: 型チェック確認**

Run: `pnpm tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/hooks/use-uploads.ts
git commit -m "feat: アップロード応答のdocumentIdをStagedFileに保持"
```

---

## Task 10: use-agent の run が attachmentDocIds を運ぶ

**Files:**
- Modify: `src/hooks/use-agent.ts:20-37,100-160`

- [ ] **Step 1: 実装（emptyTurn / appendRunTurn / run シグネチャ・ボディ）**

`src/hooks/use-agent.ts`:

`emptyTurn` に第3引数を追加:

```typescript
export function emptyTurn(query: string, attachments: string[], attachmentDocIds: string[] = []): Turn {
  return {
    query, steps: [], answer: "", streaming: false, citationMap: {},
    sourceIds: [], sources: [], tokens: 0, durationMs: 0,
    status: "running", attachments, attachmentDocIds,
  };
}
```

`appendRunTurn` に `attachmentDocIds` を追加:

```typescript
export function appendRunTurn(
  prev: Record<string, ConvState>,
  key: string,
  query: string,
  attachments: string[],
  attachmentDocIds: string[],
  truncateFrom: number | undefined,
): Record<string, ConvState> {
  const turns = prev[key]?.turns ?? [];
  const base = truncateFrom != null ? turns.slice(0, truncateFrom) : turns;
  return { ...prev, [key]: { turns: [...base, emptyTurn(query, attachments, attachmentDocIds)] } };
}
```

`run` のシグネチャに `attachmentDocIds` を追加（`attachments` の直後）し、ボディと各 `emptyTurn`/`appendRunTurn` 呼び出しに反映:

```typescript
  const run = useCallback(
    async (
      query: string,
      attachments: string[],
      attachmentDocIds: string[],
      threadId: string | undefined,
      modelId: string | undefined,
      cb: { onPendingThread?: (id: string) => void; onThread?: (id: string, previousId?: string) => void; onDone?: (id: string, status: ConvStatus) => void;
            truncateFrom?: number; regenerateFrom?: number } = {},
    ): Promise<{ status: ConvStatus; threadId: string }> => {
```

```typescript
      setConvs((prev) => appendRunTurn(prev, key, query, attachments, attachmentDocIds, cb.truncateFrom));
```

```typescript
          body: JSON.stringify({ query, attachments, attachmentDocIds, threadId, model: modelId, regenerateFrom: cb.regenerateFrom }),
```

`moveConversation` と else 分岐の `emptyTurn(query, attachments)` を `emptyTurn(query, attachments, attachmentDocIds)` に更新（2箇所）:

```typescript
          setConvs((prev) => moveConversation(prev, previousKey, realId, emptyTurn(query, attachments, attachmentDocIds)));
```

```typescript
          setConvs((prev) => (prev[key]?.turns.length ? prev : { ...prev, [key]: { turns: [emptyTurn(query, attachments, attachmentDocIds)] } }));
```

注: `run` 呼び出し元は workspace の `startRun` のみ（Task 11 で更新）。`appendRunTurn` の他の呼び出し元がないか `grep -rn "appendRunTurn\|emptyTurn\|\.run(" src` で確認し、あれば併せて更新。

- [ ] **Step 2: 型チェック確認**

Run: `pnpm tsc --noEmit`
Expected: `startRun` の `agent.run(...)` 呼び出しが引数不足でエラー（Task 11 で解消するため、この時点ではエラーが残ってよい）。`use-agent.ts` 自体・テストにエラーが無いことを確認。

- [ ] **Step 3: コミット**

```bash
git add src/hooks/use-agent.ts
git commit -m "feat: use-agentのrunで添付documentIdsを運ぶ"
```

---

## Task 11: workspace の startRun が docIds を収集して渡す

**Files:**
- Modify: `src/components/workspace/workspace.tsx:157-218`

- [ ] **Step 1: 実装（ready 添付の documentId 収集・再生成再利用・run へ伝播）**

`src/components/workspace/workspace.tsx` の `startRun` 内、`attachNames` を組み立てている箇所の直後に docIds 収集を追加:

```typescript
      const attachNames = regen != null ? (regenTurn?.attachments ?? []) : ready.map((f) => f.name);
      const attachDocIds = regen != null
        ? (regenTurn?.attachmentDocIds ?? [])
        : ready.map((f) => f.documentId).filter((x): x is string => !!x);
```

`agent.run(...)` 呼び出しに `attachDocIds` を追加（第3引数）:

```typescript
      await agent.run(finalQuery, attachNames, attachDocIds, continueId, model.id, {
```

- [ ] **Step 2: 型チェックとビルド確認**

Run: `pnpm tsc --noEmit`
Expected: エラーなし（全引数が揃う）

- [ ] **Step 3: Lint 確認**

Run: `pnpm lint`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/components/workspace/workspace.tsx
git commit -m "feat: startRunで添付documentIdsを収集してエージェントへ渡す"
```

---

## Task 12: composer がアップロード処理中の送信をブロック

**Files:**
- Modify: `src/components/chat/composer.tsx:1-10,54-55,143-178`
- Test: `src/components/chat/composer.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く（純粋ヘルパ composerSubmitState）**

`src/components/chat/composer.test.ts` を新規作成:

```typescript
import { expect, test } from "vitest";
import { composerSubmitState } from "@/components/chat/composer";
import type { StagedFile } from "@/lib/types";

function file(status: StagedFile["status"]): StagedFile {
  return { id: status, name: "f", size: 1, status, progress: 0 };
}

test("blocks submit while an attachment is uploading or processing", () => {
  expect(composerSubmitState({ value: "質問", attachments: [file("uploading")], running: false }))
    .toEqual({ pending: true, canSubmit: false });
  expect(composerSubmitState({ value: "質問", attachments: [file("processing")], running: false }))
    .toEqual({ pending: true, canSubmit: false });
});

test("allows submit once attachments are ready", () => {
  expect(composerSubmitState({ value: "", attachments: [file("ready")], running: false }))
    .toEqual({ pending: false, canSubmit: true });
  expect(composerSubmitState({ value: "質問", attachments: [file("ready")], running: false }))
    .toEqual({ pending: false, canSubmit: true });
});

test("text alone allows submit; empty with no ready attachment does not", () => {
  expect(composerSubmitState({ value: "質問", attachments: [], running: false }))
    .toEqual({ pending: false, canSubmit: true });
  expect(composerSubmitState({ value: "  ", attachments: [], running: false }))
    .toEqual({ pending: false, canSubmit: false });
});

test("skipped/error attachments do not block, but need text or a ready file", () => {
  expect(composerSubmitState({ value: "質問", attachments: [file("skipped")], running: false }))
    .toEqual({ pending: false, canSubmit: true });
  expect(composerSubmitState({ value: "", attachments: [file("error")], running: false }))
    .toEqual({ pending: false, canSubmit: false });
});

test("running disables submit regardless", () => {
  expect(composerSubmitState({ value: "質問", attachments: [file("ready")], running: true }))
    .toEqual({ pending: false, canSubmit: false });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test -- src/components/chat/composer.test.ts`
Expected: FAIL（`composerSubmitState` is not exported）

- [ ] **Step 3: 最小実装（純粋ヘルパ + コンポーネント適用）**

`src/components/chat/composer.tsx` の import 直後に純粋ヘルパを追加:

```typescript
/** 送信可否判定。添付が1件でも処理中(pending)なら送信不可。空入力かつ ready 添付なしも不可。 */
export function composerSubmitState(
  { value, attachments, running }: { value: string; attachments: StagedFile[]; running: boolean },
): { pending: boolean; canSubmit: boolean } {
  const pending = attachments.some((a) => a.status === "uploading" || a.status === "processing");
  const hasReady = attachments.some((a) => a.status === "ready");
  const canSubmit = !running && !pending && (value.trim() !== "" || hasReady);
  return { pending, canSubmit };
}
```

`Composer` 本体の `canSubmit` 定義を置き換え:

```typescript
  const { pending, canSubmit } = composerSubmitState({ value, attachments, running });
```

`onKeyDown` の Enter 分岐は `!running` を `canSubmit` 前提に保ちつつ、`canSubmit` のみで送信判定する（`pending` は `canSubmit` に内包済み）。現状の `if (e.key === "Enter" && !e.shiftKey && !running)` を以下に変更:

```typescript
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) onSubmit();
            }
```

submit ボタンに pending 時の `title` を付与（`disabled={!canSubmit}` は既存のまま）:

```typescript
            <button
              type="submit"
              disabled={!canSubmit}
              title={pending ? "アップロード完了までお待ちください" : undefined}
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 text-white transition-[background,filter] max-md:h-[34px] max-md:w-[34px]",
                canSubmit ? "bg-accent hover:brightness-105" : "cursor-not-allowed bg-divider text-muted-2",
              )}
            >
```

フッターのヒントに pending 分岐を追加。現状の `{running ? ( "⌘+⌫ で実行をキャンセル" ) : ( <>Enterで送信 …</> )}` を以下に変更:

```typescript
        {running ? (
          "⌘+⌫ で実行をキャンセル"
        ) : pending ? (
          "アップロード完了までお待ちください…"
        ) : (
          <>
            Enterで送信 · Shift+Enterで改行 · ファイルをドラッグ&ドロップ · <kbd>⌘N</kbd> で新規スレッド
          </>
        )}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- src/components/chat/composer.test.ts`
Expected: PASS

- [ ] **Step 5: 型チェック・Lint 確認**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/components/chat/composer.tsx src/components/chat/composer.test.ts
git commit -m "feat: アップロード処理中はコンポーザーの送信をブロック"
```

---

## Task 13: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: Next.js ユニットテスト全実行**

Run: `pnpm test -- --project unit`
Expected: 全 PASS

- [ ] **Step 2: 型チェックと Lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: エラーなし

- [ ] **Step 3: rag テスト全実行**

Run: rag コンテナ/venv で `pytest rag/tests -q`
Expected: 全 PASS

- [ ] **Step 4: rag 再ビルド確認**

Run: `docker compose up -d --build rag && docker compose ps`
Expected: rag が healthy（Task 3 で実施済みなら再確認のみ）

- [ ] **Step 5: 手動 E2E 確認**

1. アプリを起動しログイン。
2. 会話ドックでファイル（例: JSON）をアップロード → **処理中は送信ボタンが無効・フッターに「アップロード完了までお待ちください」が出る**ことを確認。
3. ready 後に「これ何が書いてある？」と送信 → **添付ファイルの内容に基づいた回答**が返り、出典がその添付文書であることを確認。
4. 添付なしの通常質問が従来どおり KB 全体から回答することを確認。

- [ ] **Step 6: 設計との突き合わせ**

設計ドキュメントの「ゴール」「エッジケース」が満たされていることを確認し、ブランチの最終コミットを確認:

Run: `git log --oneline -14`

---

## Self-Review メモ（計画作成者による確認結果）

- **Spec coverage:** 問題1=Task 12、問題2=Task 1〜11 で網羅。型(Task 8)/アップロード保持(Task 9)/再生成再利用(Task 11)/排他スコープ(Task 1,5)/添付名注入(Task 6)すべて対応。
- **型整合:** `documentIds`(TS)↔`document_ids`(rag) の境界は Task 4 で変換。`attachmentDocIds` は use-agent→route→run→tools で一貫。`composerSubmitState`/`buildUserContent`/`_scope_filter` の名称は各 Task 間で一致。
- **依存順:** Task 10 完了時点で workspace 側が一時的に型エラー（引数不足）になるが Task 11 で解消（Step 2 に明記済み）。rag 系(Task 1-3)と TS 系(Task 4-12)は独立に着手可能。
