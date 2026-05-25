# フェーズ4: 検索（ハイブリッド + rerank + 近傍拡張）

> 前提・共通規約は [README.md](./README.md) を参照。

**このフェーズのゴール:** rag に `POST /retrieve` を実装し、dense+sparse ハイブリッド検索（Qdrant RRF）→ bge-reranker-v2-m3 で再順位付け → 近傍チャンク拡張までを 1 ホップで返す。web 側に rag を叩く検索クライアントを新設（`run.ts` 差し替えはフェーズ5）。

**依存:** フェーズ3

**作成/変更するファイル:**
- Modify: `rag/app/vectorstore/qdrant.py`（`hybrid_search` 追加）
- Create: `rag/app/reranker/__init__.py`, `rag/app/reranker/base.py`, `rag/app/reranker/bge.py`, `rag/app/reranker/factory.py`
- Create: `rag/app/retrieval/__init__.py`, `rag/app/retrieval/service.py`
- Create: `rag/app/routers/retrieve.py`, Modify: `rag/app/main.py`, `rag/app/schemas.py`
- Create: `rag/tests/test_hybrid_search.py`, `rag/tests/test_retrieval_service.py`, `rag/tests/test_retrieve_api.py`
- Create (web): `src/lib/agent/retrieve-client.ts`, `src/lib/agent/retrieve-client.test.ts`

---

### Task 1: Qdrant ハイブリッド検索（RRF 融合）

**Files:**
- Modify: `rag/app/vectorstore/qdrant.py`
- Create: `rag/tests/test_hybrid_search.py`

- [ ] **Step 1: 失敗テスト（要 qdrant 起動 / StubEmbedder）**

`rag/tests/test_hybrid_search.py`:
```python
import uuid

from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore

COLL = "test_hybrid_" + uuid.uuid4().hex[:8]


def _row(store, e, text, owner="u1", doc="d1"):
    v = e.embed([text])[0]
    return {
        "chunk_id": str(uuid.uuid4()), "document_id": doc, "owner_user_id": owner,
        "heading_path": "H", "page_start": 0, "page_end": 0, "block_type": "text",
        "source_type": "doc", "text": text, "vector": v,
    }


def test_hybrid_search_filters_owner_and_ranks():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=COLL, dim=8)
    store.ensure_collection()
    store.upsert([_row(store, e, "認証トークンの失効", owner="u1"),
                  _row(store, e, "請求書の発行", owner="u1"),
                  _row(store, e, "他人の文書", owner="u2")])

    qv = e.embed(["認証トークンの失効"])[0]
    hits = store.hybrid_search(qv, owner_user_id="u1", limit=10)
    assert all(h["owner_user_id"] == "u1" for h in hits)   # u2 は除外
    assert hits[0]["text"] == "認証トークンの失効"          # 完全一致が上位
    store.drop()
```

- [ ] **Step 2: 失敗を確認 → 実装**

Run: `cd rag && uv run pytest tests/test_hybrid_search.py -v` → FAIL（`hybrid_search` 未定義）

`rag/app/vectorstore/qdrant.py` に追記:
```python
    def hybrid_search(self, query_vec, owner_user_id: str, limit: int = 40) -> list[dict]:
        flt = models.Filter(must=[models.FieldCondition(
            key="owner_user_id", match=models.MatchValue(value=owner_user_id))])
        res = self.client.query_points(
            self.collection,
            prefetch=[
                models.Prefetch(query=query_vec.dense, using=DENSE, limit=limit, filter=flt),
                models.Prefetch(
                    query=models.SparseVector(
                        indices=list(query_vec.sparse.keys()),
                        values=list(query_vec.sparse.values())),
                    using=SPARSE, limit=limit, filter=flt),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=limit,
            with_payload=True,
        )
        out = []
        for p in res.points:
            payload = dict(p.payload or {})
            payload["score"] = p.score
            out.append(payload)
        return out
```
（`query_vec` は `DenseSparse`。`from app.embedding.base import DenseSparse` を import 済みであることを確認。）

- [ ] **Step 3: 合格を確認**

Run: `cd rag && uv run pytest tests/test_hybrid_search.py -v`
Expected: `1 passed`

- [ ] **Step 4: コミット**

```bash
git add rag/app/vectorstore/qdrant.py rag/tests/test_hybrid_search.py
git commit -m "feat: Qdrant ハイブリッド検索（dense+sparse の RRF 融合・owner フィルタ）を追加"
```

---

### Task 2: リランカ抽象（bge-reranker + スタブ）

**Files:**
- Create: `rag/app/reranker/__init__.py`, `rag/app/reranker/base.py`, `rag/app/reranker/bge.py`, `rag/app/reranker/factory.py`
- Create: `rag/tests/test_reranker_factory.py`
- Modify: `rag/pyproject.toml`（FlagEmbedding は導入済み）

- [ ] **Step 1: 失敗テスト**

`rag/tests/test_reranker_factory.py`:
```python
from app.reranker.factory import StubReranker, get_reranker


def test_stub_reranker_scores_by_overlap():
    r = StubReranker()
    scores = r.score("認証 トークン", ["認証トークンの失効", "請求書の発行"])
    assert scores[0] > scores[1]


def test_factory_returns_stub(monkeypatch):
    monkeypatch.setenv("RERANKER", "stub")
    assert isinstance(get_reranker(), StubReranker)
```

- [ ] **Step 2: 失敗を確認 → 実装**

Run: `cd rag && uv run pytest tests/test_reranker_factory.py -v` → FAIL

`rag/app/reranker/__init__.py`: 空。

`rag/app/reranker/base.py`:
```python
from typing import Protocol


class Reranker(Protocol):
    def score(self, query: str, docs: list[str]) -> list[float]: ...
```

`rag/app/reranker/factory.py`:
```python
import os

from app.reranker.base import Reranker


class StubReranker:
    """文字 n-gram 重なりで擬似スコア（テスト/オフライン用）。"""
    def score(self, query: str, docs: list[str]) -> list[float]:
        qset = set(query.replace(" ", ""))
        return [len(qset & set(d)) / (len(qset) or 1) for d in docs]


def get_reranker() -> Reranker:
    kind = os.getenv("RERANKER", "bge")
    if kind == "stub":
        return StubReranker()
    if kind == "bge":
        from app.reranker.bge import BGEReranker
        return BGEReranker()
    raise ValueError(f"unknown RERANKER: {kind}")
```

`rag/app/reranker/bge.py`:
```python
from app.config import settings


class BGEReranker:
    def __init__(self):
        from FlagEmbedding import FlagReranker
        self.model = FlagReranker("BAAI/bge-reranker-v2-m3",
                                  use_fp16=settings.device == "cuda", device=settings.device)

    def score(self, query: str, docs: list[str]) -> list[float]:
        if not docs:
            return []
        scores = self.model.compute_score([[query, d] for d in docs], normalize=True)
        return [float(s) for s in (scores if isinstance(scores, list) else [scores])]
```

`rag/app/config.py` の `Settings` に `reranker: str = "bge"` を追加。

- [ ] **Step 3: 合格を確認**

Run: `cd rag && uv run pytest tests/test_reranker_factory.py -v`
Expected: `2 passed`

- [ ] **Step 4: コミット**

```bash
git add rag/app/reranker rag/app/config.py rag/tests/test_reranker_factory.py
git commit -m "feat: リランカ抽象（bge-reranker-v2-m3 + スタブ）を追加"
```

---

### Task 3: 検索サービス（融合 → rerank → 近傍拡張・TDD）

**Files:**
- Create: `rag/app/retrieval/__init__.py`, `rag/app/retrieval/service.py`
- Modify: `rag/app/schemas.py`
- Create: `rag/tests/test_retrieval_service.py`

- [ ] **Step 1: 応答スキーマを追加**

`rag/app/schemas.py` に追記:
```python
class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    heading_path: str
    page_start: int
    page_end: int
    block_type: str
    text: str
    expanded_text: str
    score: float


class RetrieveRequest(BaseModel):
    query: str
    rewritten: str | None = None
    owner_user_id: str
    top_k: int = 6
    candidate_k: int = 40


class RetrieveResponse(BaseModel):
    chunks: list[RetrievedChunk]
```

- [ ] **Step 2: 失敗テスト（要 qdrant+postgres、stub embedder/reranker）**

`rag/tests/test_retrieval_service.py`:
```python
import uuid

from app.db import SessionLocal
from app.models import Chunk, Document
from app.embedding.factory import StubEmbedder
from app.reranker.factory import StubReranker
from app.retrieval.service import retrieve
from app.vectorstore.qdrant import QdrantStore

COLL = "test_retr_" + uuid.uuid4().hex[:8]


def test_retrieve_reranks_and_expands_neighbors():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection=COLL, dim=8)
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

    res = retrieve(session, store, e, r, query="認証トークン 失効",
                   owner_user_id="u1", top_k=1, candidate_k=10)
    assert len(res) == 1
    top = res[0]
    assert "失効する" in top.text
    assert top.document_title == "設計.pdf"
    # 近傍拡張: 前後の文脈が expanded_text に含まれる
    assert "前の文脈" in top.expanded_text and "次の文脈" in top.expanded_text

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit(); session.close()
```

- [ ] **Step 3: 失敗を確認 → 実装**

Run: `cd rag && uv run pytest tests/test_retrieval_service.py -v` → FAIL

`rag/app/retrieval/__init__.py`: 空。

`rag/app/retrieval/service.py`:
```python
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


def retrieve(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
             *, query: str, owner_user_id: str, top_k: int = 6,
             candidate_k: int = 40) -> list[RetrievedChunk]:
    qv = embedder.embed([query])[0]
    hits = store.hybrid_search(qv, owner_user_id=owner_user_id, limit=candidate_k)
    if not hits:
        return []

    rr = reranker.score(query, [h["text"] for h in hits])
    ranked = sorted(zip(hits, rr), key=lambda x: x[1], reverse=True)[:top_k]

    title_cache: dict[str, str] = {}
    out: list[RetrievedChunk] = []
    for hit, score in ranked:
        doc_id = hit["document_id"]
        if doc_id not in title_cache:
            doc = session.get(Document, doc_id)
            title_cache[doc_id] = doc.filename if doc else doc_id
        chunk = session.get(Chunk, hit["chunk_id"])
        ordinal = chunk.ordinal if chunk else 0
        out.append(RetrievedChunk(
            chunk_id=hit["chunk_id"], document_id=doc_id,
            document_title=title_cache[doc_id], heading_path=hit.get("heading_path", ""),
            page_start=hit.get("page_start", 0), page_end=hit.get("page_end", 0),
            block_type=hit.get("block_type", "text"), text=hit["text"],
            expanded_text=_expand(session, doc_id, ordinal), score=float(score),
        ))
    return out
```

- [ ] **Step 4: 合格を確認**

Run: `cd rag && uv run pytest tests/test_retrieval_service.py -v`
Expected: `1 passed`

- [ ] **Step 5: コミット**

```bash
git add rag/app/retrieval rag/app/schemas.py rag/tests/test_retrieval_service.py
git commit -m "feat: 検索サービス（RRF→rerank→近傍拡張）を追加"
```

---

### Task 4: `/retrieve` ルータ

**Files:**
- Create: `rag/app/routers/retrieve.py`
- Modify: `rag/app/main.py`
- Create: `rag/tests/test_retrieve_api.py`

- [ ] **Step 1: 失敗テスト（依存をテスト用に上書き）**

`rag/tests/test_retrieve_api.py`:
```python
from app.config import settings
from app.main import app
from app.routers import retrieve as retrieve_router
from app.schemas import RetrievedChunk
from fastapi.testclient import TestClient


def test_retrieve_requires_token():
    client = TestClient(app)
    res = client.post("/retrieve", json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 401


def test_retrieve_returns_chunks(monkeypatch):
    def fake_run(req):
        return [RetrievedChunk(chunk_id="c1", document_id="d1", document_title="t",
                               heading_path="H", page_start=0, page_end=0, block_type="text",
                               text="body", expanded_text="exp", score=0.9)]
    monkeypatch.setattr(retrieve_router, "_run_retrieve", fake_run)
    client = TestClient(app)
    res = client.post("/retrieve", headers={"x-internal-token": settings.rag_internal_token},
                      json={"query": "x", "owner_user_id": "u1"})
    assert res.status_code == 200
    assert res.json()["chunks"][0]["chunk_id"] == "c1"
```

- [ ] **Step 2: 失敗を確認 → 実装**

Run: `cd rag && uv run pytest tests/test_retrieve_api.py -v` → FAIL

`rag/app/routers/retrieve.py`:
```python
from fastapi import APIRouter, Depends

from app.db import SessionLocal
from app.embedding.factory import get_embedder
from app.reranker.factory import get_reranker
from app.retrieval.service import retrieve as run_retrieve_service
from app.schemas import RetrieveRequest, RetrieveResponse, RetrievedChunk
from app.security import require_internal_token
from app.vectorstore.qdrant import QdrantStore

router = APIRouter()


def _run_retrieve(req: RetrieveRequest) -> list[RetrievedChunk]:
    session = SessionLocal()
    try:
        embedder = get_embedder()
        dim = getattr(embedder, "dim", 1024)
        store = QdrantStore(dim=dim)
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
```

`rag/app/main.py` に `from app.routers import retrieve` と `app.include_router(retrieve.router)` を追加。

- [ ] **Step 3: 合格を確認 + 全 rag テスト**

Run: `cd rag && uv run pytest -v`
Expected: 全 green

- [ ] **Step 4: コミット**

```bash
git add rag/app/routers/retrieve.py rag/app/main.py rag/tests/test_retrieve_api.py
git commit -m "feat: /retrieve ルータを追加"
```

---

### Task 5: web 検索クライアント（rag /retrieve のラッパ）

**Files:**
- Create: `src/lib/agent/retrieve-client.ts`, `src/lib/agent/retrieve-client.test.ts`

> 既存 `src/lib/agent/retriever.ts`（lexical 版）はこのフェーズでは温存（`run.ts` がまだ使用）。差し替え・削除はフェーズ5。

- [ ] **Step 1: 失敗テスト**

`src/lib/agent/retrieve-client.test.ts`:
```ts
import { afterEach, expect, test, vi } from "vitest";
import { retrieveChunks } from "@/lib/agent/retrieve-client";

afterEach(() => vi.restoreAllMocks());

test("retrieveChunks posts to rag /retrieve and returns chunks", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ chunks: [{ chunk_id: "c1", document_id: "d1",
      document_title: "t", heading_path: "H", page_start: 0, page_end: 0,
      block_type: "text", text: "b", expanded_text: "e", score: 0.9 }] }),
      { status: 200 }));
  process.env.RAG_SERVICE_URL = "http://rag:8000";

  const chunks = await retrieveChunks({ query: "q", ownerUserId: "u1", topK: 6 });
  expect(chunks[0].chunkId).toBe("c1");
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("http://rag:8000/retrieve");
  expect(JSON.parse(init!.body as string).owner_user_id).toBe("u1");
});
```

- [ ] **Step 2: 失敗を確認 → 実装**

Run: `pnpm test src/lib/agent/retrieve-client.test.ts` → FAIL

`src/lib/agent/retrieve-client.ts`:
```ts
import { ragFetch } from "@/lib/rag-client";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  headingPath: string;
  pageStart: number;
  pageEnd: number;
  blockType: string;
  text: string;
  expandedText: string;
  score: number;
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
  if (!res.ok) throw new Error(`retrieve failed: ${res.status}`);
  const data = (await res.json()) as { chunks: Array<Record<string, unknown>> };
  return data.chunks.map((c) => ({
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
  }));
}
```

- [ ] **Step 3: 合格 + lint + コミット**

Run: `pnpm test src/lib/agent/retrieve-client.test.ts && pnpm lint`
```bash
git add src/lib/agent/retrieve-client.ts src/lib/agent/retrieve-client.test.ts
git commit -m "feat: web に rag /retrieve クライアントを追加"
```

---

## フェーズ4 完了条件
- `cd rag && uv run pytest` 全 green（hybrid/reranker/service/api）
- 既知コーパスで完全一致が上位に来る（rerank 後）
- 近傍拡張で前後チャンクが `expanded_text` に入る
- web の `retrieveChunks` がモック rag に対して正しい契約で動く
