# Agentic RAG 移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定6段パイプラインを AI SDK v6 のマルチステップ・ツールループへ置き換え、同一スレッド内でマルチターンに会話を継続できる agentic RAG にする。

**Architecture:** 1つのモデルに `retrieve` / `fetch_document` を `tool()` として渡し `stopWhen: stepCountIs(6)` でループ。`result.fullStream` のパーツ（tool-call / tool-result / text-delta / finish）を既存 SSE `AgentEvent` へマッピング。引用はターンスコープの `CitationRegistry` で番号を統合。過去ターンを `ModelMessage[]` として履歴注入。クライアントは会話を `turns: Turn[]` として保持し、各ターンのツール活動は折りたたみ `AgentActivity` で表示。

**Tech Stack:** Next.js 16 / TypeScript / AI SDK v6 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) / zod / Drizzle (Postgres) / FastAPI + SQLAlchemy (rag) / Vitest / Pytest / Playwright

**前提コマンド:** web テスト=`pnpm test`（vitest run）、単体=`pnpm exec vitest run <file>`、型/Lint=`pnpm lint`、ビルド=`pnpm build`。rag テスト=`cd rag && uv run pytest <path> -v`。

参照 spec: `docs/superpowers/specs/2026-05-27-agentic-rag-migration-design.md`

---

## File Structure

作成:
- `rag/app/documents_service.py` — 文書チャンク取得の純ロジック（窓掛け/上限）。
- `src/lib/agent/citations.ts` — `CitationRegistry`（ターンスコープの引用番号付け）。
- `src/lib/agent/tools.ts` — `buildTools()`（`retrieve` / `fetch_document` の `tool()` 定義）。
- `src/lib/agent/history.ts` — DB メッセージ → `ModelMessage[]`（窓掛け）。
- `src/components/chat/agent-activity.tsx` — 折りたたみツール活動ブロック。
- 各テスト: `rag/tests/test_fetch_document_api.py`, `src/lib/agent/citations.test.ts`, `src/lib/agent/tools.test.ts`, `src/lib/agent/history.test.ts`, `src/hooks/use-agent-reduce.test.ts`。

変更:
- `rag/app/schemas.py` — `FetchDocumentRequest/Response`, `FetchedChunk` 追加。
- `rag/app/routers/documents.py` — `POST /documents/{document_id}/chunks` 追加。
- `src/lib/agent/retrieve-client.ts` — `fetchDocument()` 追加。
- `src/lib/types.ts` — `ToolName` に `retrieve`/`answer`、`Turn` 型、`done` から messageId は持たない（据置）。
- `src/lib/agent/run.ts` — ツールループへ全面書き換え。
- `src/lib/threads.ts` — `getThreadMessages()` 追加。
- `src/app/api/threads/[id]/route.ts` — 全ターン返却へ。
- `src/app/api/chat/route.ts` — 履歴ロードして `runAgent` に渡す。
- `src/hooks/use-agent.ts` — `ConvState` を `turns: Turn[]` へ。reducer を純関数として抽出。
- `src/components/chat/messages.tsx` / `src/components/workspace/workspace.tsx` — トランスクリプト描画。
- `src/components/chat/tool-steps.tsx` — `TOOL_ICONS` に `retrieve`/`answer` 追加。
- `tests-e2e/rag-flow.spec.ts` — マルチターン継続シナリオ追加。

実装順は依存順（rag → client → 引用 → ツール → run → 履歴/route → クライアント状態 → UI → e2e）。

---

## Task 1: rag `fetch_document` エンドポイント

**Files:**
- Create: `rag/app/documents_service.py`
- Modify: `rag/app/schemas.py`, `rag/app/routers/documents.py`
- Test: `rag/tests/test_fetch_document_api.py`

- [ ] **Step 1: 窓掛け/上限の純ロジックの失敗テストを書く**

Create `rag/tests/test_fetch_document_api.py`:

```python
from app.documents_service import select_chunks


class _C:
    def __init__(self, ordinal):
        self.ordinal = ordinal
        self.id = f"c{ordinal}"


def test_select_chunks_truncates_to_max():
    chunks = [_C(i) for i in range(100)]
    out = select_chunks(chunks, around_ordinal=None, window=2, max_chunks=40)
    assert len(out) == 40
    assert out[0].ordinal == 0


def test_select_chunks_windows_around_ordinal():
    chunks = [_C(i) for i in range(100)]
    out = select_chunks(chunks, around_ordinal=50, window=2, max_chunks=40)
    assert [c.ordinal for c in out] == [48, 49, 50, 51, 52]
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `cd rag && uv run pytest tests/test_fetch_document_api.py -v`
Expected: FAIL（`ModuleNotFoundError: app.documents_service`）

- [ ] **Step 3: 純ロジックを実装**

Create `rag/app/documents_service.py`:

```python
"""文書チャンクの選択ロジック（窓掛け・上限）。DB I/O は含まない純関数。"""

MAX_CHUNKS = 40
WINDOW = 2


def select_chunks(chunks, *, around_ordinal, window=WINDOW, max_chunks=MAX_CHUNKS):
    """ordinal 昇順前提の chunks から、窓掛け（around 指定時）と上限を適用して返す。"""
    if around_ordinal is not None:
        lo, hi = around_ordinal - window, around_ordinal + window
        chunks = [c for c in chunks if lo <= c.ordinal <= hi]
    return chunks[:max_chunks]
```

- [ ] **Step 4: 実行して成功を確認**

Run: `cd rag && uv run pytest tests/test_fetch_document_api.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: schemas を追加**

Modify `rag/app/schemas.py`（末尾に追加）:

```python
class FetchedChunk(BaseModel):
    chunk_id: str
    ordinal: int
    heading_path: str
    page_start: int
    page_end: int
    block_type: str
    text: str


class FetchDocumentRequest(BaseModel):
    owner_user_id: str
    around_chunk_id: str | None = None


class FetchDocumentResponse(BaseModel):
    document_id: str
    document_title: str
    chunks: list[FetchedChunk]
```

- [ ] **Step 6: ルータの API テスト（token / 200 / 404）を追加**

Append to `rag/tests/test_fetch_document_api.py`:

```python
from app.config import settings
from app.routers import documents as documents_router
from app.schemas import FetchDocumentResponse, FetchedChunk


def test_fetch_document_requires_token(client):
    res = client.post("/documents/d1/chunks", json={"owner_user_id": "u1"})
    assert res.status_code == 401


def test_fetch_document_returns_chunks(client, monkeypatch):
    def fake(document_id, req):
        return FetchDocumentResponse(
            document_id=document_id, document_title="設計.pdf",
            chunks=[FetchedChunk(chunk_id="c1", ordinal=0, heading_path="認証",
                                 page_start=0, page_end=0, block_type="text", text="本文")])
    monkeypatch.setattr(documents_router, "_fetch_document", fake)
    res = client.post("/documents/d1/chunks",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "u1"})
    assert res.status_code == 200
    body = res.json()
    assert body["document_title"] == "設計.pdf"
    assert body["chunks"][0]["chunk_id"] == "c1"


def test_fetch_document_404_when_not_owner(client, monkeypatch):
    class _Doc:
        owner_user_id = "owner-A"
    class _Session:
        def get(self, model, _id):
            return _Doc()
        def query(self, *a, **k):
            raise AssertionError("should not query when ownership fails")
        def close(self):
            pass
    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.post("/documents/d1/chunks",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "intruder-B"})
    assert res.status_code == 404
```

- [ ] **Step 7: 実行して失敗を確認**

Run: `cd rag && uv run pytest tests/test_fetch_document_api.py -v`
Expected: FAIL（`/documents/d1/chunks` が 404/405、`_fetch_document` 未定義）

- [ ] **Step 8: ルータを実装**

Modify `rag/app/routers/documents.py`:

冒頭の import に追加:

```python
from app.models import Chunk, Document, IngestJob
from app.schemas import FetchDocumentRequest, FetchDocumentResponse, FetchedChunk, IngestStarted
from app.documents_service import select_chunks
```

（既存の `from app.models import Document, IngestJob` と `from app.schemas import IngestStarted` は上の行に統合して重複させない。）

ファイル末尾に追加:

```python
def _fetch_document(document_id: str, req: FetchDocumentRequest) -> FetchDocumentResponse:
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != req.owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        rows = (session.query(Chunk)
                .filter(Chunk.document_id == document_id)
                .order_by(Chunk.ordinal).all())
        around = None
        if req.around_chunk_id:
            center = next((c for c in rows if c.id == req.around_chunk_id), None)
            around = center.ordinal if center else None
        rows = select_chunks(rows, around_ordinal=around)
        return FetchDocumentResponse(
            document_id=doc.id, document_title=doc.filename,
            chunks=[FetchedChunk(chunk_id=c.id, ordinal=c.ordinal, heading_path=c.heading_path,
                                 page_start=c.page_start, page_end=c.page_end,
                                 block_type=c.block_type, text=c.text) for c in rows])
    finally:
        session.close()


@router.post("/documents/{document_id}/chunks", response_model=FetchDocumentResponse,
             dependencies=[Depends(require_internal_token)])
def fetch_document_chunks(document_id: str, req: FetchDocumentRequest):
    return _fetch_document(document_id, req)
```

- [ ] **Step 9: 実行して全テスト成功を確認**

Run: `cd rag && uv run pytest tests/test_fetch_document_api.py -v`
Expected: PASS（5 件）

- [ ] **Step 10: コミット**

```bash
git add rag/app/documents_service.py rag/app/schemas.py rag/app/routers/documents.py rag/tests/test_fetch_document_api.py
git commit -m "feat: rag に文書チャンク取得エンドポイントを追加"
```

---

## Task 2: web `fetchDocument()` クライアント

**Files:**
- Modify: `src/lib/agent/retrieve-client.ts`
- Test: `src/lib/agent/retrieve-client.test.ts`

- [ ] **Step 1: 失敗テストを追加**

Append to `src/lib/agent/retrieve-client.test.ts`:

```typescript
import { fetchDocument } from "@/lib/agent/retrieve-client";

test("fetchDocument posts to rag /documents/{id}/chunks and maps chunks", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ document_id: "d1", document_title: "設計.pdf",
      chunks: [{ chunk_id: "c1", ordinal: 0, heading_path: "認証", page_start: 0,
        page_end: 0, block_type: "text", text: "本文" }] }), { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const doc = await fetchDocument({ documentId: "d1", ownerUserId: "u1", aroundChunkId: "c0" });
  expect(doc.documentTitle).toBe("設計.pdf");
  expect(doc.chunks[0].chunkId).toBe("c1");
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("http://rag:8000/documents/d1/chunks");
  const body = JSON.parse(init!.body as string);
  expect(body.owner_user_id).toBe("u1");
  expect(body.around_chunk_id).toBe("c0");
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `pnpm exec vitest run src/lib/agent/retrieve-client.test.ts`
Expected: FAIL（`fetchDocument` がエクスポートされていない）

- [ ] **Step 3: 実装**

Append to `src/lib/agent/retrieve-client.ts`:

```typescript
export interface FetchedDocChunk {
  chunkId: string;
  ordinal: number;
  headingPath: string;
  pageStart: number;
  pageEnd: number;
  blockType: string;
  text: string;
}

export interface FetchedDocument {
  documentId: string;
  documentTitle: string;
  chunks: FetchedDocChunk[];
}

export async function fetchDocument(input: {
  documentId: string;
  ownerUserId: string;
  aroundChunkId?: string;
}): Promise<FetchedDocument> {
  const res = await ragFetch(`/documents/${encodeURIComponent(input.documentId)}/chunks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner_user_id: input.ownerUserId,
      around_chunk_id: input.aroundChunkId ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`fetchDocument failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    document_id: string; document_title: string; chunks: Array<Record<string, unknown>>;
  };
  return {
    documentId: data.document_id,
    documentTitle: data.document_title,
    chunks: data.chunks.map((c) => ({
      chunkId: c.chunk_id as string,
      ordinal: c.ordinal as number,
      headingPath: c.heading_path as string,
      pageStart: c.page_start as number,
      pageEnd: c.page_end as number,
      blockType: c.block_type as string,
      text: c.text as string,
    })),
  };
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `pnpm exec vitest run src/lib/agent/retrieve-client.test.ts`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/retrieve-client.ts src/lib/agent/retrieve-client.test.ts
git commit -m "feat: rag 文書取得を呼ぶ fetchDocument クライアントを追加"
```

---

## Task 3: 引用レジストリ（`CitationRegistry`）

**Files:**
- Create: `src/lib/agent/citations.ts`
- Test: `src/lib/agent/citations.test.ts`

ターン内で集めた chunk に一意な通し番号を割り当て、完了時に `sources` / `citationMap` へ変換する。`Source`/`CitationMap` は `@/lib/types`。

- [ ] **Step 1: 失敗テストを書く**

Create `src/lib/agent/citations.test.ts`:

```typescript
import { expect, test } from "vitest";
import { CitationRegistry } from "@/lib/agent/citations";

test("register assigns sequential numbers and dedupes by chunkId", () => {
  const reg = new CitationRegistry();
  const n1 = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
    headingPath: "認証", snippet: "本文1" });
  const n2 = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c2",
    headingPath: "認可", snippet: "本文2" });
  const n1again = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
    headingPath: "認証", snippet: "本文1" });
  expect([n1, n2, n1again]).toEqual([1, 2, 1]);
});

test("toSources groups by document and toCitationMap maps ordinals", () => {
  const reg = new CitationRegistry();
  reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c1", headingPath: "h1", snippet: "s1" });
  reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c2", headingPath: "h2", snippet: "s2" });
  reg.register({ documentId: "d2", documentTitle: "B", chunkId: "c3", headingPath: "h3", snippet: "s3" });

  const sources = reg.toSources();
  expect(sources.map((s) => s.id)).toEqual(["d1", "d2"]);
  expect(sources[0].sections.map((x) => x.id)).toEqual(["c1", "c2"]);

  const map = reg.toCitationMap();
  expect(map[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
  expect(map[3]).toMatchObject({ sourceId: "d2", sectionId: "c3" });
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `pnpm exec vitest run src/lib/agent/citations.test.ts`
Expected: FAIL（`CitationRegistry` 未定義）

- [ ] **Step 3: 実装**

Create `src/lib/agent/citations.ts`:

```typescript
import type { CitationMap, Source } from "@/lib/types";

export interface CitationInput {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  headingPath: string;
  snippet: string;
}

/** 1ターンスコープの引用番号付け。chunkId をキーに通し番号 [n] を割り当てる。 */
export class CitationRegistry {
  private order: CitationInput[] = [];
  private index = new Map<string, number>(); // chunkId -> n

  register(c: CitationInput): number {
    const existing = this.index.get(c.chunkId);
    if (existing) return existing;
    const n = this.order.length + 1;
    this.order.push(c);
    this.index.set(c.chunkId, n);
    return n;
  }

  /** document 単位に束ねた Source[]（登録順を保持）。 */
  toSources(): Source[] {
    const byDoc = new Map<string, Source>();
    for (const c of this.order) {
      let src = byDoc.get(c.documentId);
      if (!src) {
        src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
                author: "", date: "", sections: [] };
        byDoc.set(c.documentId, src);
      }
      if (!src.sections.some((s) => s.id === c.chunkId)) {
        src.sections.push({ id: c.chunkId, heading: c.headingPath, body: c.snippet, highlight: true });
      }
    }
    return [...byDoc.values()];
  }

  toCitationMap(): CitationMap {
    const map: CitationMap = {};
    this.order.forEach((c, i) => { map[i + 1] = { sourceId: c.documentId, sectionId: c.chunkId }; });
    return map;
  }

  get size(): number {
    return this.order.length;
  }
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `pnpm exec vitest run src/lib/agent/citations.test.ts`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/agent/citations.ts src/lib/agent/citations.test.ts
git commit -m "feat: ターンスコープの引用レジストリを追加"
```

---

## Task 4: ツール定義（`retrieve` / `fetch_document`）と ToolName 拡張

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/agent/tools.ts`
- Test: `src/lib/agent/tools.test.ts`

ツールの `execute` は「モデル向けの番号付きテキスト」を文字列で返し、同時に `toolCallId` をキーにUI用メタ（要約・件数）を記録する。

- [ ] **Step 1: `ToolName` に `retrieve`/`answer` を追加**

Modify `src/lib/types.ts`（`ToolName` union）:

```typescript
export type ToolName =
  | "rewrite_query"
  | "retrieve"
  | "vector_search"
  | "bm25_search"
  | "rerank"
  | "fetch_document"
  | "summarize"
  | "answer"
  | "web_search"
  | "python_sandbox"
  | "sql_query";
```

- [ ] **Step 2: ツールの失敗テストを書く**

Create `src/lib/agent/tools.test.ts`:

```typescript
import { expect, test, vi } from "vitest";

vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(async () => [{
    chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
    pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
    expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
  }]),
  fetchDocument: vi.fn(async () => ({
    documentId: "d1", documentTitle: "設計.pdf",
    chunks: [{ chunkId: "c2", ordinal: 1, headingPath: "認可", pageStart: 0, pageEnd: 0,
      blockType: "text", text: "認可の本文。" }],
  })),
}));

import { buildTools } from "@/lib/agent/tools";
import { CitationRegistry } from "@/lib/agent/citations";

test("retrieve tool registers citations and returns numbered text", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta });
  const out = await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);

  expect(typeof out).toBe("string");
  expect(out).toContain("[1]");
  expect(out).toContain("失効");
  expect(reg.size).toBe(1);
  expect(meta.get("call-1")).toMatchObject({ name: "retrieve", summary: expect.stringContaining("1") });
});

test("fetch_document tool registers citations and records meta", async () => {
  const reg = new CitationRegistry();
  const meta = new Map();
  const tools = buildTools({ registry: reg, ownerUserId: "u1", meta });
  const out = await tools.fetch_document.execute!(
    { document_id: "d1" }, { toolCallId: "call-2", messages: [] } as never);

  expect(out).toContain("[1]");
  expect(reg.size).toBe(1);
  expect(meta.get("call-2")).toMatchObject({ name: "fetch_document" });
});
```

- [ ] **Step 3: 実行して失敗を確認**

Run: `pnpm exec vitest run src/lib/agent/tools.test.ts`
Expected: FAIL（`buildTools` 未定義）

- [ ] **Step 4: 実装**

Create `src/lib/agent/tools.ts`:

```typescript
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { retrieveChunks, fetchDocument } from "@/lib/agent/retrieve-client";
import { CitationRegistry } from "@/lib/agent/citations";

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
}

const RETRIEVE_TOP_K = 6;

export function buildTools({ registry, ownerUserId, meta }: BuildToolsInput): ToolSet {
  return {
    retrieve: tool({
      description:
        "社内ナレッジから関連箇所を検索する。ユーザーの質問に答えるために必要な事実を集めるとき、" +
        "また会話の文脈を踏まえた具体的なクエリで何度でも呼べる。",
      inputSchema: z.object({
        query: z.string().describe("検索クエリ（会話文脈を解決した自己完結な日本語）"),
      }),
      execute: async ({ query }, { toolCallId }) => {
        const chunks = await retrieveChunks({ query, ownerUserId, topK: RETRIEVE_TOP_K });
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
        "特定の文書の全文（または指定チャンク周辺）を取得して深掘りする。" +
        "retrieve の結果から得た document_id を指定する。",
      inputSchema: z.object({
        document_id: z.string().describe("retrieve 結果に含まれる文書ID"),
        around_chunk_id: z.string().optional().describe("この chunk の周辺だけ欲しいときに指定"),
      }),
      execute: async ({ document_id, around_chunk_id }, { toolCallId }) => {
        const doc = await fetchDocument({ documentId: document_id, ownerUserId, aroundChunkId: around_chunk_id });
        const lines = doc.chunks.map((c) => {
          const n = registry.register({
            documentId: doc.documentId, documentTitle: doc.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: c.text,
          });
          return `[${n}] ${doc.documentTitle} — ${c.headingPath}\n${c.text}`;
        });
        meta.set(toolCallId, { name: "fetch_document", input: { document_id, around_chunk_id },
          summary: `${doc.documentTitle} → ${doc.chunks.length} 段` });
        return lines.length ? lines.join("\n\n") : "文書の本文が取得できませんでした。";
      },
    }),
  };
}
```

- [ ] **Step 5: 実行して成功を確認**

Run: `pnpm exec vitest run src/lib/agent/tools.test.ts`
Expected: PASS（2 件）

- [ ] **Step 6: コミット**

```bash
git add src/lib/types.ts src/lib/agent/tools.ts src/lib/agent/tools.test.ts
git commit -m "feat: retrieve / fetch_document のエージェントツールを追加"
```

---

## Task 5: `runAgent` をツールループへ書き換え

**Files:**
- Modify: `src/lib/agent/run.ts`
- Test: `src/lib/agent/run.test.ts`

`streamText({ messages, tools, stopWhen: stepCountIs(6) })` を実行し、`result.fullStream` のパーツを `AgentEvent` へマッピング。`tool-call`→step(running)、`tool-result`→step(done)（meta から summary/output）、`text-delta`→answer、`finish`→done。

- [ ] **Step 1: `run.test.ts` を新仕様に書き換え（失敗テスト）**

Replace `src/lib/agent/run.test.ts` の全文:

```typescript
import { expect, test, vi } from "vitest";
import type { ToolSet } from "ai";

// retrieve-client はツール経由でのみ使われる。ツールの execute がレジストリ登録する様子を再現するため
// tools をモックせず、retrieve-client をモックして実 buildTools を通す。
vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(async () => [{
    chunkId: "c1", documentId: "d1", documentTitle: "設計.pdf", headingPath: "認証",
    pageStart: 0, pageEnd: 0, blockType: "text", text: "トークンは24時間で失効する。",
    expandedText: "前文。トークンは24時間で失効する。後文。", score: 0.9,
  }]),
  fetchDocument: vi.fn(),
}));

// streamText を、retrieve を1回呼んでから回答を流す筋書きでモックする。
vi.mock("ai", async (orig) => {
  const actual = await orig<typeof import("ai")>();
  return {
    ...actual,
    stepCountIs: actual.stepCountIs,
    tool: actual.tool,
    streamText: vi.fn(({ tools }: { tools: ToolSet }) => {
      async function* gen() {
        yield { type: "tool-call", toolCallId: "call-1", toolName: "retrieve", input: { query: "認証" } };
        // SDK は execute を実行する。テストでは手動で呼んでレジストリ登録を発火させる。
        await tools.retrieve.execute!({ query: "認証" }, { toolCallId: "call-1", messages: [] } as never);
        yield { type: "tool-result", toolCallId: "call-1", toolName: "retrieve", input: { query: "認証" }, output: "[1] …" };
        yield { type: "text-delta", id: "t1", text: "失効" };
        yield { type: "text-delta", id: "t1", text: "します[1]。" };
        yield { type: "finish", finishReason: "stop", totalUsage: { totalTokens: 42 } };
      }
      return { fullStream: gen() };
    }),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));

import { runAgent } from "@/lib/agent/run";
import type { AgentEvent } from "@/lib/types";

process.env.ANTHROPIC_API_KEY = "test-key";

test("runAgent runs tool loop, streams answer, finishes with sources+citationMap", async () => {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ query: "認証は?", ownerUserId: "u1", threadId: "t1" })) {
    events.push(e);
  }

  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("失効");

  const steps = events.filter((e) => e.type === "step");
  // retrieve ツールの running と done が出る
  expect(steps.some((e) => e.step.name === "retrieve" && e.step.status === "running")).toBe(true);
  const retrieveDone = steps.find((e) => e.step.name === "retrieve" && e.step.status === "done");
  expect(retrieveDone).toBeDefined();
  expect(retrieveDone!.step.summary).toContain("1");

  const done = events.find((e) => e.type === "done");
  if (!done || done.type !== "done") throw new Error("done event missing");
  expect(done.threadId).toBe("t1");
  expect(done.sources[0].id).toBe("d1");
  expect(done.sources[0].sections[0].id).toBe("c1");
  expect(done.citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `pnpm exec vitest run src/lib/agent/run.test.ts`
Expected: FAIL（`runAgent` が旧パイプラインのため step 名が一致しない / 構造不一致）

- [ ] **Step 3: `run.ts` を実装**

Replace `src/lib/agent/run.ts` の全文:

```typescript
/** Server-side agentic orchestrator (real backend).
 *
 * 1つのモデルに retrieve / fetch_document を渡し stopWhen でループ。
 * fullStream のパーツを AgentEvent へマッピングする。引用は CitationRegistry で番号統合。 */

import { streamText, stepCountIs, type ModelMessage } from "ai";
import { resolveModels, DEFAULT_MODEL_ID } from "@/lib/agent/models";
import { buildTools, type ToolCallMeta } from "@/lib/agent/tools";
import { CitationRegistry } from "@/lib/agent/citations";
import type { AgentEvent, ToolCall, ToolName } from "@/lib/types";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  /** 過去ターンの履歴（user/assistant のメッセージ列、窓掛け済み）。 */
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

export async function* runAgent({ query, ownerUserId, threadId, history, modelId }: RunInput): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const resolution = resolveModels(modelId);

  // キー未設定: 検索も生成もできないため理由を返して終了。
  if (!resolution.ok) {
    yield { type: "answer-start" };
    yield { type: "answer-delta", text: resolution.reason };
    yield { type: "done", tokens: 0, durationMs: Date.now() - started,
            citationMap: {}, sourceIds: [], sources: [], threadId };
    return;
  }

  const registry = new CitationRegistry();
  const meta = new Map<string, ToolCallMeta>();
  const tools = buildTools({ registry, ownerUserId, meta });

  const messages: ModelMessage[] = [...(history ?? []), { role: "user", content: query }];

  const result = streamText({
    model: resolution.models.chat,
    system: SYSTEM,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  // toolCallId -> step / 開始時刻。tool-call で running、tool-result で done。
  const stepStart = new Map<string, number>();
  const stepById = new Map<string, ToolCall>();
  let answerStarted = false;
  let answer = "";
  let answerStepEmitted = false;
  const answerStart = { t: 0 };

  const emitAnswerStep = (status: "running" | "done"): AgentEvent => ({
    type: "step",
    step: {
      id: "answer", name: "answer" as ToolName, label: "回答生成", status,
      durationMs: status === "done" ? Date.now() - answerStart.t : 0,
      input: {}, output: null, summary: status === "done" ? "回答を生成" : "回答を生成中…",
    },
  });

  try {
    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        stepStart.set(part.toolCallId, Date.now());
        const m = meta.get(part.toolCallId);
        const step: ToolCall = {
          id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
          status: "running", durationMs: 0,
          input: (part.input ?? {}) as Record<string, unknown>, output: null,
          summary: runningSummary(part.toolName),
        };
        stepById.set(part.toolCallId, step);
        yield { type: "step", step };
        void m;
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
        yield { type: "step", step };
      } else if (part.type === "tool-error") {
        const t0 = stepStart.get(part.toolCallId) ?? Date.now();
        yield {
          type: "step",
          step: {
            id: part.toolCallId, name: part.toolName as ToolName, label: toolLabel(part.toolName),
            status: "error", durationMs: Date.now() - t0,
            input: (part.input ?? {}) as Record<string, unknown>,
            output: { error: String(part.error).slice(0, 500) }, summary: "ツール実行に失敗",
          },
        };
      } else if (part.type === "text-delta") {
        if (!answerStarted) {
          answerStarted = true;
          answerStart.t = Date.now();
          yield emitAnswerStep("running");
          answerStepEmitted = true;
          yield { type: "answer-start" };
        }
        answer += part.text;
        yield { type: "answer-delta", text: part.text };
      }
    }
  } catch {
    if (!answer) {
      if (!answerStarted) yield { type: "answer-start" };
      answer = "回答の生成に失敗しました。時間をおいて再度お試しください。";
      yield { type: "answer-delta", text: answer };
    }
  }

  // ツールを一度も呼ばず本文も無い場合のフォールバック。
  if (!answer) {
    if (!answerStarted) yield { type: "answer-start" };
    answer = registry.size === 0
      ? "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。"
      : "回答を生成できませんでした。時間をおいて再度お試しください。";
    yield { type: "answer-delta", text: answer };
  }

  if (answerStepEmitted) yield emitAnswerStep("done");

  const tokens = Math.max(1, Math.round(answer.length / 1.8));
  yield {
    type: "done",
    tokens,
    durationMs: Date.now() - started,
    citationMap: registry.toCitationMap(),
    sourceIds: registry.toSources().map((s) => s.id),
    sources: registry.toSources(),
    threadId,
  };
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

- [ ] **Step 4: 実行して成功を確認**

Run: `pnpm exec vitest run src/lib/agent/run.test.ts`
Expected: PASS（1 件）

- [ ] **Step 5: 旧 `buildInitialSteps` 依存の確認と除去判断**

Run: `grep -rn "buildInitialSteps" src/`
`src/lib/agent/steps.ts` と `src/hooks/use-agent.ts` で使用。Task 7 でクライアントを書き換えるまで残置可（ビルドは通る）。ここでは変更しない。

- [ ] **Step 6: 型チェック**

Run: `pnpm lint`
Expected: エラーなし（既存 `use-agent.ts` は未変更で通る）

- [ ] **Step 7: コミット**

```bash
git add src/lib/agent/run.ts src/lib/agent/run.test.ts
git commit -m "feat: runAgent をマルチステップ・ツールループへ書き換え"
```

---

## Task 6: マルチターン履歴（threads / API / chat route）

**Files:**
- Create: `src/lib/agent/history.ts`
- Test: `src/lib/agent/history.test.ts`
- Modify: `src/lib/threads.ts`, `src/lib/threads.test.ts`, `src/app/api/threads/[id]/route.ts`, `src/app/api/chat/route.ts`

### 6a. 履歴変換（純関数）

- [ ] **Step 1: 失敗テストを書く**

Create `src/lib/agent/history.test.ts`:

```typescript
import { expect, test } from "vitest";
import { toModelHistory } from "@/lib/agent/history";

test("converts turns to user/assistant messages in order", () => {
  const msgs = toModelHistory([
    { query: "Q1", answerText: "A1" },
    { query: "Q2", answerText: "A2" },
  ], 8);
  expect(msgs).toEqual([
    { role: "user", content: "Q1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "Q2" },
    { role: "assistant", content: "A2" },
  ]);
});

test("windows to last N turns", () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ query: `Q${i}`, answerText: `A${i}` }));
  const msgs = toModelHistory(turns, 2);
  expect(msgs).toHaveLength(4);
  expect(msgs[0]).toEqual({ role: "user", content: "Q8" });
});

test("skips empty answers (in-flight/failed turns)", () => {
  const msgs = toModelHistory([{ query: "Q1", answerText: "" }, { query: "Q2", answerText: "A2" }], 8);
  expect(msgs).toEqual([{ role: "user", content: "Q2" }, { role: "assistant", content: "A2" }]);
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `pnpm exec vitest run src/lib/agent/history.test.ts`
Expected: FAIL（`toModelHistory` 未定義）

- [ ] **Step 3: 実装**

Create `src/lib/agent/history.ts`:

```typescript
import type { ModelMessage } from "ai";

export interface HistoryTurn {
  query: string;
  answerText: string;
}

/** 過去ターン（古い順）を直近 maxTurns に窓掛けして user/assistant メッセージ列へ変換。
 *  回答が空のターン（実行中/失敗）は履歴から除外する。 */
export function toModelHistory(turns: HistoryTurn[], maxTurns: number): ModelMessage[] {
  const valid = turns.filter((t) => t.answerText.trim().length > 0);
  const windowed = valid.slice(-maxTurns);
  const out: ModelMessage[] = [];
  for (const t of windowed) {
    out.push({ role: "user", content: t.query });
    out.push({ role: "assistant", content: t.answerText });
  }
  return out;
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `pnpm exec vitest run src/lib/agent/history.test.ts`
Expected: PASS（3 件）

### 6b. `getThreadMessages`（全ターン読み出し）

- [ ] **Step 5: `threads.test.ts` にマルチターンの失敗テストを追加**

Append to `src/lib/threads.test.ts`:

```typescript
import { getThreadMessages } from "@/lib/threads";

test("getThreadMessages returns all turns oldest-first with citations", async () => {
  const t = await createThread(userId, "履歴テスト");
  await saveCompletedMessage({
    threadId: t.id, query: "Q1", answerText: "A1[1]。", tokens: 5, durationMs: 100,
    steps: [{ id: "s1" }],
    citations: [{ ordinal: 1, documentId: "d1", documentTitle: "設計.pdf",
      chunkId: "c1", sectionId: "c1", headingPath: "h", snippet: "本文" }],
  });
  await saveCompletedMessage({
    threadId: t.id, query: "Q2", answerText: "A2。", tokens: 4, durationMs: 90,
    steps: [], citations: [],
  });

  const turns = await getThreadMessages(t.id, userId);
  expect(turns.map((x) => x.completed.query)).toEqual(["Q1", "Q2"]);
  expect(turns[0].sources[0].id).toBe("d1");
  expect(turns[0].citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
});
```

- [ ] **Step 6: 実行して失敗を確認**

Run: `pnpm exec vitest run src/lib/threads.test.ts`
Expected: FAIL（`getThreadMessages` 未定義）

注: このテストは Postgres（host 5433）への接続が必要。`.env.local` の `DATABASE_URL` が起動済み DB を指していること。

- [ ] **Step 7: `getThreadMessages` を実装**

Modify `src/lib/threads.ts`。`getThreadDetail` は残しつつ（互換）、全ターン版を追加。ファイル末尾付近（`sourcesFromCitations` の前）に追加:

```typescript
/** スレッドの全ターンを古い順に復元（各ターン = 1 完了メッセージ）。 */
export async function getThreadMessages(threadId: string, userId: string): Promise<ThreadDetail[] | null> {
  const [t] = await db.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
  if (!t) return null;

  const msgs = await db.select().from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
  if (msgs.length === 0) {
    return [{ completed: { query: t.title, answerText: "", tokens: 0, durationMs: 0 },
              sources: [], citationMap: {}, steps: [] }];
  }

  const out: ThreadDetail[] = [];
  for (const msg of msgs) {
    const cites = await db.select().from(citations).where(eq(citations.messageId, msg.id));
    const sources = sourcesFromCitations(cites);
    const citationMap: CitationMap = {};
    for (const c of cites) citationMap[c.ordinal] = { sourceId: c.documentId, sectionId: c.sectionId };
    out.push({
      completed: { query: msg.query, answerText: msg.answerText, tokens: msg.tokens, durationMs: msg.durationMs },
      sources, citationMap, steps: msg.steps as ToolCall[],
    });
  }
  return out;
}
```

- [ ] **Step 8: 実行して成功を確認**

Run: `pnpm exec vitest run src/lib/threads.test.ts`
Expected: PASS（既存 + 新規）

### 6c. API ルートと chat route

- [ ] **Step 9: `/api/threads/[id]` を全ターン返却へ**

Read `src/app/api/threads/[id]/route.ts` で現状を確認し、`getThreadDetail` 呼び出しを `getThreadMessages` に変更してレスポンスを `{ turns: ThreadDetail[] }` 形に変更する。

実装（GET ハンドラ本体の該当部分を置換）:

```typescript
import { getThreadMessages } from "@/lib/threads";
// ...
const turns = await getThreadMessages(id, claims.sub);
if (!turns) return NextResponse.json({ error: "not found" }, { status: 404 });
return NextResponse.json({ turns });
```

（既存が `{ ...detail }` を返していた場合は呼び出し側 Task 8 で `turns` 前提に合わせる。）

- [ ] **Step 10: `chat route` で履歴をロードして `runAgent` に渡す**

Modify `src/app/api/chat/route.ts`。`runAgent` 呼び出しの直前に履歴をロード:

冒頭 import に追加:

```typescript
import { createThread, saveCompletedMessage, getThreadMessages } from "@/lib/threads";
import { toModelHistory } from "@/lib/agent/history";
```

`const tid = ...` の後、ストリーム開始前に:

```typescript
  // 既存スレッドへの追記なら過去ターンを履歴として読み込む（直近8ターン窓）。
  let history: Awaited<ReturnType<typeof toModelHistory>> = [];
  if (threadId) {
    const prior = await getThreadMessages(tid, claims.sub);
    if (prior) {
      history = toModelHistory(
        prior.map((p) => ({ query: p.completed.query, answerText: p.completed.answerText })),
        8,
      );
    }
  }
```

`runAgent({ ... })` 呼び出しに `history` を追加:

```typescript
for await (const event of runAgent({ query: q, ownerUserId: claims.sub, threadId: tid, modelId: model, history })) {
```

- [ ] **Step 11: 型チェック**

Run: `pnpm lint`
Expected: エラーなし

- [ ] **Step 12: コミット**

```bash
git add src/lib/agent/history.ts src/lib/agent/history.test.ts src/lib/threads.ts src/lib/threads.test.ts src/app/api/threads/ src/app/api/chat/route.ts
git commit -m "feat: マルチターン履歴のロードと runAgent への注入"
```

---

## Task 7: クライアント状態をターン配列へ（`use-agent` / `types`）

**Files:**
- Modify: `src/lib/types.ts`, `src/hooks/use-agent.ts`
- Test: `src/hooks/use-agent-reduce.test.ts`（新規・純関数）

`ConvState` を「単一Q&A」から `{ turns: Turn[] }` へ。各ターンの reducer を純関数 `reduceTurn` として抽出しテストする。

- [ ] **Step 1: `Turn` 型を追加**

Modify `src/lib/types.ts`（`CompletedThread` の近くに追加）:

```typescript
/** 1ターン分（ユーザー質問 + エージェント実行 + 回答）。 */
export interface Turn {
  query: string;
  steps: ToolCall[];
  answer: string;
  streaming: boolean;
  citationMap: CitationMap;
  sourceIds: string[];
  sources: Source[];
  tokens: number;
  durationMs: number;
  status: "running" | "done" | "cancelled" | "error";
  attachments: string[];
}
```

- [ ] **Step 2: reducer 純関数の失敗テストを書く**

Create `src/hooks/use-agent-reduce.test.ts`:

```typescript
import { expect, test } from "vitest";
import { emptyTurn, reduceTurn } from "@/hooks/use-agent";
import type { AgentEvent } from "@/lib/types";

test("reduceTurn appends unknown steps and updates known ones", () => {
  let turn = emptyTurn("Q", []);
  const running: AgentEvent = { type: "step", step: { id: "call-1", name: "retrieve",
    label: "検索", status: "running", durationMs: 0, input: {}, output: null, summary: "検索中…" } };
  turn = reduceTurn(turn, running);
  expect(turn.steps).toHaveLength(1);

  const done: AgentEvent = { type: "step", step: { ...running.step, status: "done", summary: "6件" } };
  turn = reduceTurn(turn, done);
  expect(turn.steps).toHaveLength(1);
  expect(turn.steps[0].status).toBe("done");
});

test("reduceTurn streams answer and finalizes on done", () => {
  let turn = emptyTurn("Q", []);
  turn = reduceTurn(turn, { type: "answer-start" });
  turn = reduceTurn(turn, { type: "answer-delta", text: "失効" });
  turn = reduceTurn(turn, { type: "answer-delta", text: "します。" });
  expect(turn.answer).toBe("失効します。");
  expect(turn.streaming).toBe(true);

  turn = reduceTurn(turn, { type: "done", tokens: 12, durationMs: 800,
    citationMap: { 1: { sourceId: "d1", sectionId: "c1" } }, sourceIds: ["d1"],
    sources: [{ id: "d1", type: "doc", title: "A", path: "A", author: "", date: "", sections: [] }],
    threadId: "t1" });
  expect(turn.streaming).toBe(false);
  expect(turn.status).toBe("done");
  expect(turn.tokens).toBe(12);
  expect(turn.citationMap[1]).toMatchObject({ sourceId: "d1" });
});
```

- [ ] **Step 3: 実行して失敗を確認**

Run: `pnpm exec vitest run src/hooks/use-agent-reduce.test.ts`
Expected: FAIL（`emptyTurn`/`reduceTurn` がエクスポートされていない）

- [ ] **Step 4: `use-agent.ts` を書き換え**

Replace `src/hooks/use-agent.ts` の全文:

```typescript
"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentEvent, Turn } from "@/lib/types";

export type ConvStatus = "running" | "done" | "cancelled" | "error";

/** スレッドの会話状態 = ターンの配列。 */
export interface ConvState {
  turns: Turn[];
}

export const LIVE_KEY = "th-current";

export function emptyTurn(query: string, attachments: string[]): Turn {
  return {
    query, steps: [], answer: "", streaming: false, citationMap: {},
    sourceIds: [], sources: [], tokens: 0, durationMs: 0,
    status: "running", attachments,
  };
}

/** 1ターンに対する AgentEvent の畳み込み（純関数・テスト対象）。 */
export function reduceTurn(t: Turn, event: AgentEvent): Turn {
  switch (event.type) {
    case "step": {
      const exists = t.steps.some((s) => s.id === event.step.id);
      return {
        ...t,
        steps: exists
          ? t.steps.map((s) => (s.id === event.step.id ? { ...s, ...event.step } : s))
          : [...t.steps, event.step],
      };
    }
    case "answer-start":
      return { ...t, streaming: true, answer: "" };
    case "answer-delta":
      return { ...t, answer: t.answer + event.text };
    case "done":
      return {
        ...t, streaming: false, citationMap: event.citationMap, sourceIds: event.sourceIds,
        sources: event.sources, tokens: event.tokens, durationMs: event.durationMs, status: "done",
      };
    case "error":
      return { ...t, streaming: false, status: "error" };
    default:
      return t;
  }
}

/** Drives agent runs over the /api/chat SSE stream, keyed by threadId.
 *  各スレッドは turns 配列を保持し、新しい run は末尾ターンへ畳み込む。 */
export function useAgent() {
  const [convs, setConvs] = useState<Record<string, ConvState>>({});
  const controllers = useRef<Record<string, AbortController>>({});

  const get = useCallback((id: string): ConvState | undefined => convs[id], [convs]);

  /** 完了済みスレッドの全ターンを slot へロード（live runs は触らない）。 */
  const loadCompleted = useCallback((id: string, turns: Turn[]) => {
    setConvs((prev) => ({ ...prev, [id]: { turns } }));
  }, []);

  /** 末尾ターンへ event を畳み込む helper。 */
  const applyToLastTurn = (state: ConvState | undefined, event: AgentEvent): ConvState => {
    const turns = state?.turns ?? [];
    if (turns.length === 0) return { turns };
    const last = turns[turns.length - 1];
    return { turns: [...turns.slice(0, -1), reduceTurn(last, event)] };
  };

  const run = useCallback(
    async (
      query: string,
      attachments: string[],
      threadId: string | undefined,
      modelId: string | undefined,
      cb: { onThread?: (id: string) => void; onDone?: (id: string, status: ConvStatus) => void } = {},
    ): Promise<{ status: ConvStatus; threadId: string }> => {
      const ctrl = new AbortController();
      let key = threadId ?? LIVE_KEY;

      // 新しいターンを末尾に追加（既存スレッドなら過去ターンの後ろ、新規なら最初のターン）。
      const appendTurn = (k: string) => setConvs((prev) => {
        const turns = prev[k]?.turns ?? [];
        return { ...prev, [k]: { turns: [...turns, emptyTurn(query, attachments)] } };
      });

      if (threadId) {
        controllers.current[key] = ctrl;
        appendTurn(key);
      }

      const finish = (status: ConvStatus): { status: ConvStatus; threadId: string } => {
        setConvs((prev) => {
          const c = prev[key];
          if (!c || c.turns.length === 0) return prev;
          const last = c.turns[c.turns.length - 1];
          const nextLast = { ...last, streaming: false,
            status: last.status === "running" ? status : last.status };
          return { ...prev, [key]: { turns: [...c.turns.slice(0, -1), nextLast] } };
        });
        delete controllers.current[key];
        cb.onDone?.(key, status);
        return { status, threadId: key };
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, attachments, threadId, model: modelId }),
          signal: ctrl.signal,
        });

        const realId = res.headers.get("X-Thread-Id") || key;
        if (realId !== key) {
          controllers.current[realId] = ctrl;
          delete controllers.current[key];
          // 仮キーに積んだターンを実キーへ移し替える（新規スレッド時）。
          setConvs((prev) => {
            const moved = prev[key]?.turns ?? [];
            const next = { ...prev };
            delete next[key];
            next[realId] = { turns: [...(prev[realId]?.turns ?? []), ...(threadId ? [] : moved)] };
            return next;
          });
          key = realId;
        } else if (!controllers.current[key]) {
          controllers.current[key] = ctrl;
        }
        // 実キー側にターンが無ければ（新規スレッド経路）ここで追加。
        setConvs((prev) => (prev[key]?.turns.length ? prev : { ...prev, [key]: { turns: [emptyTurn(query, attachments)] } }));
        cb.onThread?.(key);

        if (!res.ok || !res.body) return finish("error");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5).trim()) as AgentEvent;
            setConvs((prev) => ({ ...prev, [key]: applyToLastTurn(prev[key], event) }));
          }
        }
        return finish("done");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return finish("cancelled");
        return finish("error");
      }
    },
    [],
  );

  const cancel = useCallback((id: string) => {
    controllers.current[id]?.abort();
    setConvs((prev) => {
      const c = prev[id];
      if (!c || c.turns.length === 0) return prev;
      const last = c.turns[c.turns.length - 1];
      const nextLast = { ...last, streaming: false, status: "cancelled" as const,
        steps: last.steps.map((s) => (s.status === "running"
          ? { ...s, status: "pending" as const, summary: "キャンセルされました" } : s)) };
      return { ...prev, [id]: { turns: [...c.turns.slice(0, -1), nextLast] } };
    });
  }, []);

  const remove = useCallback((id: string) => {
    controllers.current[id]?.abort();
    delete controllers.current[id];
    setConvs((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { convs, get, run, cancel, loadCompleted, remove };
}
```

- [ ] **Step 5: 実行して成功を確認**

Run: `pnpm exec vitest run src/hooks/use-agent-reduce.test.ts`
Expected: PASS（2 件）

- [ ] **Step 6: 旧 `buildInitialSteps`/`steps.ts` の扱い**

`reduceTurn`/`emptyTurn` は `buildInitialSteps` を使わない。`src/lib/agent/steps.ts` と `src/lib/data.ts` の `SAMPLE_TOOL_CALLS` は他参照が無ければ Task 8 完了後に削除。ここでは `grep -rn "buildInitialSteps\|SAMPLE_TOOL_CALLS" src/` で参照を確認するに留める。

- [ ] **Step 7: コミット**

```bash
git add src/lib/types.ts src/hooks/use-agent.ts src/hooks/use-agent-reduce.test.ts
git commit -m "feat: 会話状態をターン配列化し reducer を純関数へ抽出"
```

---

## Task 8: UI — トランスクリプト描画と折りたたみ活動ブロック

**Files:**
- Create: `src/components/chat/agent-activity.tsx`
- Modify: `src/components/chat/tool-steps.tsx`, `src/components/chat/messages.tsx`, `src/components/workspace/workspace.tsx`
- 検証: 型/Lint/ビルド + Task 9 e2e（このタスクに単体テストは無い）

### 8a. ToolName アイコン追加

- [ ] **Step 1: `TOOL_ICONS` に `retrieve`/`answer` を追加**

Modify `src/components/chat/tool-steps.tsx` の `TOOL_ICONS`（`vector_search` のエントリの後に追加）:

```typescript
  retrieve: (
    <>
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </>
  ),
  answer: <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
```

### 8b. `AgentActivity` 折りたたみブロック

- [ ] **Step 2: `AgentActivity` を実装**

Create `src/components/chat/agent-activity.tsx`:

```typescript
"use client";

import { useState } from "react";
import { ToolSteps } from "@/components/chat/tool-steps";
import { cn, formatMs } from "@/lib/utils";
import type { ToolCall, ToolView } from "@/lib/types";

/** ターンのツール活動。実行中は展開、完了後は1行サマリへ畳む。 */
export function AgentActivity({
  steps, variant, running, expandedMap, onToggleStep,
}: {
  steps: ToolCall[];
  variant: ToolView;
  running: boolean;
  expandedMap: Record<string, boolean>;
  onToggleStep: (id: string) => void;
}) {
  // 実行中は既定で開く。完了したら畳む（ユーザーが開閉した値を優先）。
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? running;

  if (steps.length === 0) return null;

  const totalMs = steps.reduce((a, s) => a + (s.durationMs || 0), 0);
  const current = steps.find((s) => s.status === "running");

  return (
    <div className="overflow-hidden rounded-[14px] border-[0.5px] border-divider-strong bg-surface-2">
      <button
        onClick={() => setOpen(!isOpen)}
        className="flex w-full items-center justify-between border-0 bg-transparent px-3.5 py-2.5 text-left hover:bg-surface max-md:px-3"
      >
        <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-fg">
          {running ? (
            <span className="h-3 w-3 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          )}
          {running ? (current?.summary ?? "エージェント実行中…") : "エージェント実行"}
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
          {steps.length} ステップ · {formatMs(totalMs)}
          <span className={cn("transition-transform", isOpen && "rotate-180")}>
            <svg viewBox="0 0 16 16" width="11" height="11">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="border-t-[0.5px] border-divider">
          <ToolSteps steps={steps} variant={variant} expandedMap={expandedMap} onToggleStep={onToggleStep} />
        </div>
      )}
    </div>
  );
}
```

注: `ToolSteps` は自前の枠（`wrapCls` と `WrapHead`）を持つため二重枠になる。Step 2 後に `tool-steps.tsx` の `ToolSteps` から外枠 `wrapCls` と `WrapHead` を外し（中身のリストのみ返す）、`AgentActivity` 側を唯一の枠にするリファクタを行う。具体的には `ToolSteps` の各 `return (<div className={wrapCls}> ... </div>)` を内側要素のみへ簡素化し、`WrapHead` 呼び出しを削除する。

- [ ] **Step 3: `ToolSteps` の外枠/ヘッダを除去**

Modify `src/components/chat/tool-steps.tsx` の `ToolSteps`:

```typescript
export function ToolSteps({ steps, variant, expandedMap, onToggleStep }: Props) {
  if (variant === "log") return <ToolStepLog steps={steps} />;
  if (variant === "timeline") {
    return (
      <div className="px-3.5 pb-3 pt-2 max-md:px-3">
        {steps.map((s, i) => (
          <ToolStepTimeline key={s.id} step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} isLast={i === steps.length - 1} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {steps.map((s) => (
        <ToolStepCard key={s.id} step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} />
      ))}
    </div>
  );
}
```

未使用になった `WrapHead` を削除（`grep -n "WrapHead" src/components/chat/tool-steps.tsx` で他参照が無いことを確認のうえ関数定義ごと除去）。

### 8c. messages.tsx にターン描画コンポーネント追加

- [ ] **Step 4: `Transcript` を実装**

Append to `src/components/chat/messages.tsx`:

```typescript
import { AgentActivity } from "@/components/chat/agent-activity";
import { AnswerFooter, CancelledNotice } from "@/components/chat/answer-footer";
import { UserAttachments } from "@/components/uploads/uploads";
import type { CitationStyle, StagedFile, Turn, ToolView } from "@/lib/types";

export function Transcript({
  turns, toolView, expandedSteps, onToggleStep, onCite, citationStyle,
  onCopy, onRegenerate, onFeedback, feedback, liveAttachments, isLiveLastTurn,
}: {
  turns: Turn[];
  toolView: ToolView;
  expandedSteps: Record<string, boolean>;
  onToggleStep: (id: string) => void;
  // どのターンの引用かを特定するため turn index を渡す。
  onCite: (n: number, turnIdx: number) => void;
  citationStyle: CitationStyle;
  onCopy: () => void;
  onRegenerate: () => void;
  onFeedback: (v: "up" | "down") => void;
  feedback: "up" | "down" | null;
  liveAttachments: StagedFile[];
  isLiveLastTurn: boolean;
}) {
  return (
    <>
      {turns.map((turn, idx) => {
        const isLast = idx === turns.length - 1;
        const running = turn.status === "running";
        return (
          <div key={idx} className="flex flex-col gap-6 max-md:gap-[18px]">
            <UserMessage text={turn.query} />
            <AssistantMessage>
              {isLast && isLiveLastTurn && liveAttachments.length > 0 && <UserAttachments files={liveAttachments} />}
              {running && turn.steps.length === 0 && (
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="h-3 w-3 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
                  考え中…
                </div>
              )}
              <AgentActivity
                steps={turn.steps}
                variant={toolView}
                running={running}
                expandedMap={expandedSteps}
                onToggleStep={onToggleStep}
              />
              {turn.status === "cancelled" ? (
                <CancelledNotice onRetry={onRegenerate} />
              ) : (
                (turn.answer.length > 0 || turn.streaming) && (
                  <StreamingAnswer text={turn.answer} streaming={turn.streaming} onCite={(n) => onCite(n, idx)} citationStyle={citationStyle} />
                )
              )}
              {turn.status === "done" && (
                <AnswerFooter
                  tokens={turn.tokens} durationMs={turn.durationMs} sources={turn.sources}
                  onCopy={onCopy} onRegenerate={onRegenerate} onFeedback={onFeedback} feedback={feedback}
                />
              )}
            </AssistantMessage>
          </div>
        );
      })}
    </>
  );
}
```

### 8d. workspace.tsx をターン配列前提へ

- [ ] **Step 5: `workspace.tsx` を更新**

Read `src/components/workspace/workspace.tsx` を再確認のうえ、以下を変更:

1. `view = agent.get(activeThreadId)` の後、`conv` を廃し `turns = view?.turns ?? []`、`lastTurn = turns[turns.length - 1]` を導入。
2. ステータス同期（`activeStatus`）は `lastTurn?.status` を参照。
3. 右パネル/ヘッダは「アクティブな引用が属するターン」を指す state を新設：`const [activeCiteTurn, setActiveCiteTurn] = useState(0)`。引用クリックは turn index を受け取る形に変更し、対象ターンの `citationMap` を引く。ヘッダの sources 数と右パネルは `turns[activeCiteTurn]`（既定は末尾ターン）を使う。`openCitation` を次に置換:

```tsx
  const openCitation = (n: number, turnIdx: number) => {
    const turn = turns[turnIdx];
    const c = turn?.citationMap[n];
    if (!c) return;
    setActiveCiteTurn(turnIdx);
    setActiveSourceId(c.sourceId);
    setHighlightSectionId(c.sectionId);
    setRightPanelOpen(true);
  };
```

右パネル/ヘッダ参照用に `const citeTurn = turns[activeCiteTurn] ?? lastTurn;` を導入し、`conv.sources`→`citeTurn?.sources ?? []`、`conv.citationMap`→`citeTurn?.citationMap ?? {}` に置換。`activeCiteTurn` の既定は末尾に追従させる（新ターン追加時に `turns.length - 1` へ）。
4. body 描画を従来の単一 `UserMessage`+`AssistantMessage` ブロックから `<Transcript turns={turns} .../>` へ置換。
5. `startRun` の追記判定（`continueId`）は据置（既存 thread かつ末尾ターンが running でないとき継続）。`emptyTurn` の追加は `useAgent` 側で処理されるため workspace 側の特別処理は不要。
6. `copyAnswer` / `exportThread` は `lastTurn?.answer` を参照するよう変更。
7. auto-open 右パネルの条件 `conv.streaming && conv.answer.length > 60` は `lastTurn?.streaming && (lastTurn?.answer.length ?? 0) > 60` に。
8. auto-scroll 依存配列の `conv.answer, conv.steps` は `lastTurn?.answer, lastTurn?.steps?.length` に。

具体的な差し替え（body 部分、`phase === "empty"` 分岐の else 側）:

```tsx
              <div className={cn(
                "mx-auto flex max-w-[1020px] flex-col gap-6 px-8 pb-[60px] pt-7 max-md:max-w-none max-md:gap-[18px] max-md:px-3.5 max-md:pb-20 max-md:pt-[18px]",
                tweaks.density === "compact" && "gap-4 px-5 pb-10 pt-[18px]",
              )}>
                <Transcript
                  turns={turns}
                  toolView={tweaks.toolView}
                  expandedSteps={expandedSteps}
                  onToggleStep={(id) => setExpandedSteps((m) => ({ ...m, [id]: !m[id] }))}
                  onCite={openCitation}
                  citationStyle={tweaks.citationStyle}
                  onCopy={copyAnswer}
                  onRegenerate={regenerate}
                  onFeedback={(v) => {
                    setFeedback((prev) => (prev === v ? null : v));
                    if (feedback !== v) push(v === "up" ? "フィードバックを送信しました" : "改善要望を受け付けました", "success");
                  }}
                  feedback={feedback}
                  liveAttachments={userAttachments}
                  isLiveLastTurn={isLive}
                />
              </div>
```

import に `Transcript` を追加し、未使用になる `StreamingAnswer` 直接利用や `ToolSteps` import は整理する。

- [ ] **Step 6: `selectThread` のロードを turns 配列へ**

`selectThread` 内のサーバ取得を `{ turns }` 前提に変更:

```tsx
      fetch(`/api/threads/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { turns: import("@/lib/types").Turn[] | { completed: { query: string; answerText: string; tokens: number; durationMs: number }; sources: Source[]; citationMap: import("@/lib/types").CitationMap; steps: import("@/lib/types").ToolCall[] }[] } | null) => {
          if (data && data.turns) {
            const turns = data.turns.map((d) => ("answer" in d ? d as import("@/lib/types").Turn : {
              query: d.completed.query, steps: (d.steps ?? []).map((s) => ({ ...s, status: "done" as const })),
              answer: d.completed.answerText, streaming: false, citationMap: d.citationMap,
              sourceIds: d.sources.map((s) => s.id), sources: d.sources,
              tokens: d.completed.tokens, durationMs: d.completed.durationMs,
              status: "done" as const, attachments: [],
            }));
            agent.loadCompleted(id, turns);
            setUserQuery(turns[turns.length - 1]?.query || "");
            setPhase("done");
          } else {
            setActiveThreadId("th-current");
            setPhase("empty");
          }
        })
        .catch(() => { setActiveThreadId("th-current"); setPhase("empty"); });
```

`loadCompleted` のシグネチャは Task 7 で `(id, turns: Turn[])` に変更済み。

- [ ] **Step 7: 型チェック・Lint**

Run: `pnpm lint`
Expected: エラーなし（未使用 import を解消するまで warning/error が出たら順次除去）

- [ ] **Step 8: ビルド**

Run: `pnpm build`
Expected: 成功（型エラー無し）

- [ ] **Step 9: 手動確認**

Run: `pnpm dev` で起動 → ログイン → 1問検索 → 同一スレッドで指示語フォローアップ（例: 「その期限は?」）を送信し、(a) 過去ターンが残ること (b) 活動ブロックが実行中に展開→完了で畳むこと (c) フォローアップが文脈解決された検索になること を目視確認。

- [ ] **Step 10: 不要コードの削除**

`grep -rn "buildInitialSteps\|SAMPLE_TOOL_CALLS\|getThreadDetail" src/` を実行。参照が無くなった `src/lib/agent/steps.ts`、`src/lib/data.ts` の `SAMPLE_TOOL_CALLS`、`threads.ts` の `getThreadDetail`（および `steps.ts` のテストがあれば）を削除。参照が残る場合は残置し、その旨をコミットメッセージに記す。

- [ ] **Step 11: コミット**

```bash
git add src/components/chat/agent-activity.tsx src/components/chat/tool-steps.tsx src/components/chat/messages.tsx src/components/workspace/workspace.tsx
git commit -m "feat: トランスクリプト描画と折りたたみエージェント活動ブロックを追加"
```

---

## Task 9: e2e マルチターン継続シナリオ

**Files:**
- Modify: `tests-e2e/rag-flow.spec.ts`

- [ ] **Step 1: 既存 e2e を確認**

Read `tests-e2e/rag-flow.spec.ts` で、ログイン・送信・回答待ちの既存ヘルパとセレクタを把握する。

- [ ] **Step 2: マルチターン継続テストを追加**

既存パターン（ロケータ/待機）に合わせて、以下の流れのテストを追加する。実セレクタは既存テストに合わせて置換すること:

```typescript
test("同一スレッド内でフォローアップを継続できる", async ({ page }) => {
  // （既存ヘルパでログイン & 文書アップロード済み前提。なければ既存 setup を流用）
  // 1ターン目
  await page.getByPlaceholder(/質問|メッセージ/).fill("休暇規程の申請期限は？");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/エージェント実行/)).toBeVisible();
  // 回答を待つ（done で footer が出る）
  await expect(page.locator("text=/tokens|出典|参考資料/").first()).toBeVisible({ timeout: 30000 });

  const firstAnswer = await page.locator("[data-turn]").first().innerText().catch(() => "");

  // 2ターン目（指示語フォローアップ）
  await page.getByPlaceholder(/質問|メッセージ/).fill("その上限日数は？");
  await page.keyboard.press("Enter");

  // 過去ターンが残り、ターンが2つになる
  await expect(page.locator("[data-turn]")).toHaveCount(2, { timeout: 30000 });
  void firstAnswer;
});
```

注: `[data-turn]` セレクタを使うため、Task 8 の `Transcript` の各ターン `<div>` に `data-turn={idx}` を付与する（Step 2 でのコンポーネントに `data-turn={idx}` を追加）。

- [ ] **Step 3: `Transcript` にテスト用属性を追加**

Modify `src/components/chat/messages.tsx` の `Transcript` 内ターン `<div>`:

```tsx
          <div key={idx} data-turn={idx} className="flex flex-col gap-6 max-md:gap-[18px]">
```

- [ ] **Step 4: e2e 実行**

Run: `pnpm e2e --grep "フォローアップ"`
Expected: PASS（rag バックエンド + DB が起動している前提。CI/ローカルで未起動ならスキップ理由を記録）

- [ ] **Step 5: コミット**

```bash
git add tests-e2e/rag-flow.spec.ts src/components/chat/messages.tsx
git commit -m "test: 同一スレッドのマルチターン継続 e2e を追加"
```

---

## 全体検証

- [ ] **Step 1: web 全テスト**

Run: `pnpm test`
Expected: 全 PASS（DB 必要なテストは Postgres 起動済みであること）

- [ ] **Step 2: rag 全テスト**

Run: `cd rag && uv run pytest -v`
Expected: 全 PASS

- [ ] **Step 3: Lint / ビルド**

Run: `pnpm lint && pnpm build`
Expected: エラーなし

---

## Self-Review メモ（spec カバレッジ）

- spec 1（アーキテクチャ）→ Task 5。
- spec 2（引用レジストリ）→ Task 3 + Task 4（番号付きテキスト）。
- spec 3（fetch_document エンドポイント）→ Task 1 + Task 2。
- spec 4（マルチターン・メモリ窓掛け）→ Task 6（`toModelHistory`・`getThreadMessages`・chat route）。
- spec 5（永続化・スキーマ変更なし）→ 既存 `saveCompletedMessage` 流用（Task 6/既存 route）。スキーマ変更タスク無し（意図通り）。
- spec 6（SSE/ConvState ターン配列）→ Task 7。
- spec 7（UI 折りたたみ活動ブロック・トランスクリプト）→ Task 8。
- spec 8（エラー処理・テスト）→ Task 5（キー無し/失敗/上限）、各 Task のテスト、Task 9（e2e）。
