# フェーズ6: 仕上げ（エラー処理・GPU・E2E・ドキュメント）

> 前提・共通規約は [README.md](./README.md) を参照。

**このフェーズのゴール:** 本番運用とローカル開発の双方に耐える堅牢化。モデルロード状態のヘルスチェック、接続リトライ、取り込み失敗の再試行、フォールバック、GPU プロファイル検証、E2E、ドキュメント整備。

**依存:** フェーズ1–5

**作成/変更するファイル:**
- Modify: `rag/app/main.py`（lifespan でモデル preload + /health 拡張）
- Modify: `rag/app/vectorstore/qdrant.py`（接続リトライ）
- Create: `rag/app/routers/documents.py`（retry エンドポイント追記）, `src/app/api/uploads/[id]/retry/route.ts`
- Modify: `src/hooks/use-uploads.ts`（再試行ボタン配線）, `src/components/uploads/uploads.tsx`
- Create: `tests-e2e/`（Playwright）
- Modify: `README.md`, `.env.example`

---

### Task 1: ヘルスチェックとモデル preload

**Files:**
- Modify: `rag/app/main.py`
- Create: `rag/tests/test_health_ready.py`

- [ ] **Step 1: 失敗テスト**

`rag/tests/test_health_ready.py`:
```python
from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_device_and_readiness():
    with TestClient(app) as client:
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert "device" in body
        assert "models_loaded" in body
```

- [ ] **Step 2: 失敗を確認 → lifespan を実装**

Run: `cd rag && uv run pytest tests/test_health_ready.py -v` → FAIL（`device` 無し）

`rag/app/main.py` を更新（api プロセスは embed/rerank を遅延ロード。`EMBEDDER=stub` のテスト時はロードしない）:
```python
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import documents, jobs, retrieve

_state = {"models_loaded": False}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("PRELOAD_MODELS") == "1" and settings.embedder != "stub":
        from app.embedding.factory import get_embedder
        from app.reranker.factory import get_reranker
        get_embedder()
        get_reranker()
        _state["models_loaded"] = True
    yield


app = FastAPI(title="ARag RAG service", lifespan=lifespan)
app.include_router(documents.router)
app.include_router(jobs.router)
app.include_router(retrieve.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "device": settings.device, "models_loaded": _state["models_loaded"]}
```

compose の `rag` サービス env に `PRELOAD_MODELS: "1"` を追加し、healthcheck を設定:
```yaml
    environment:
      # ...既存...
      PRELOAD_MODELS: "1"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"]
      interval: 10s
      timeout: 5s
      retries: 20
      start_period: 120s
```

- [ ] **Step 3: 合格 + コミット**

Run: `cd rag && uv run pytest tests/test_health_ready.py -v`
```bash
git add rag/app/main.py rag/tests/test_health_ready.py docker-compose.yml
git commit -m "feat: ヘルスチェック拡張とモデル preload を追加"
```

---

### Task 2: 接続リトライと上限

**Files:**
- Modify: `rag/app/vectorstore/qdrant.py`, `src/app/api/upload/route.ts`

- [ ] **Step 1: Qdrant クライアントにタイムアウト/リトライ**

`QdrantStore.__init__` を更新:
```python
        self.client = QdrantClient(url=settings.qdrant_url, timeout=30)
```
`ensure_collection`/`hybrid_search` を、`tenacity` で 3 回・指数バックオフのリトライにラップ（一時的接続断対策）。`rag/pyproject.toml` に `tenacity>=9.0` を追加し、デコレータ `@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))` を付与。

- [ ] **Step 2: アップロードサイズ上限（web）**

`src/app/api/upload/route.ts` の file チェック直後に上限ガード:
```ts
const MAX_BYTES = 50 * 1024 * 1024; // 50MB
if (file.size > MAX_BYTES) {
  return NextResponse.json({ error: "ファイルサイズが上限(50MB)を超えています" }, { status: 413 });
}
```

- [ ] **Step 3: lint/テスト + コミット**

Run: `cd rag && uv run pytest && pnpm lint`
```bash
git add rag/app/vectorstore/qdrant.py rag/pyproject.toml rag/uv.lock src/app/api/upload/route.ts
git commit -m "feat: Qdrant 接続リトライとアップロード上限を追加"
```

---

### Task 3: 取り込み失敗の再試行

**Files:**
- Modify: `rag/app/routers/documents.py`
- Create: `src/app/api/uploads/[id]/retry/route.ts`
- Modify: `src/hooks/use-uploads.ts`, `src/components/uploads/uploads.tsx`

- [ ] **Step 1: rag に再試行エンドポイント（job をリセットして再 enqueue）**

`rag/app/routers/documents.py` に追記:
```python
@router.post("/jobs/{job_id}/retry", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def retry_job(job_id: str):
    session = SessionLocal()
    try:
        from app.models import IngestJob
        job = session.get(IngestJob, job_id)
        if not job:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="job not found")
        job.status = "queued"; job.progress = 0; job.error = None; job.stage_detail = ""
        session.commit()
        result = IngestStarted(document_id=job.document_id, job_id=job.id)
    finally:
        session.close()
    await enqueue_ingest(result.document_id, result.job_id)
    return result
```

- [ ] **Step 2: web プロキシ**

`src/app/api/uploads/[id]/retry/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  if (!token || !(await verifyAccessToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(`/jobs/${id}/retry`, { method: "POST" });
  if (!res.ok) return NextResponse.json({ error: "retry failed" }, { status: 502 });
  return NextResponse.json(await res.json());
}
```

- [ ] **Step 3: UI に再試行**

`src/hooks/use-uploads.ts` に `retry(id)` を追加（`status==="error"` の対象に `POST /api/uploads/:jobId/retry` → 成功で `status:"processing"` に戻しポーリング再開）。`src/components/uploads/uploads.tsx` の error 表示に「再試行」ボタンを追加し `retry(file.id)` を呼ぶ（既存のボタンスタイルを流用）。

- [ ] **Step 4: lint + 手動確認 + コミット**

Run: `cd rag && uv run pytest && pnpm lint`
```bash
git add rag/app/routers/documents.py src/app/api/uploads src/hooks/use-uploads.ts src/components/uploads/uploads.tsx
git commit -m "feat: 取り込み失敗時の再試行を追加"
```

---

### Task 4: フォールバック動作の検証

**Files:**
- Create: `src/lib/agent/run-fallback.test.ts`

> run.ts は既に「rag 不達 → 接続不可メッセージ」「結果 0 件 → 案内」「Anthropic は AI SDK 既定の例外」を実装済み（フェーズ5 Task 4）。ここでフォールバック分岐をテストで固定する。

- [ ] **Step 1: rag 不達のフォールバックテスト**

`src/lib/agent/run-fallback.test.ts`:
```ts
import { expect, test, vi } from "vitest";

vi.mock("@/lib/agent/retrieve-client", () => ({
  retrieveChunks: vi.fn(async () => { throw new Error("ECONNREFUSED"); }),
}));
vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "q" })),
  streamText: vi.fn(() => ({ textStream: (async function* () {})() })),
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));

import { runAgent } from "@/lib/agent/run";

test("retrieve failure yields a graceful answer and still finishes", async () => {
  const events: any[] = [];
  for await (const e of runAgent({ query: "x", ownerUserId: "u1", threadId: "t1" })) events.push(e);
  const answer = events.filter((e) => e.type === "answer-delta").map((e) => e.text).join("");
  expect(answer).toContain("接続できませんでした");
  expect(events.some((e) => e.type === "done")).toBe(true);
});
```

- [ ] **Step 2: 合格 + コミット**

Run: `pnpm test src/lib/agent/run-fallback.test.ts`
```bash
git add src/lib/agent/run-fallback.test.ts
git commit -m "test: rag 不達時のフォールバックを検証"
```

---

### Task 5: GPU プロファイル検証

> GPU マシンでのみ実行可能。CPU 環境では確認のみで可。

- [ ] **Step 1: GPU 起動**

Run（NVIDIA + nvidia-container-toolkit 前提）:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
docker compose logs rag-worker | grep -i cuda
curl -s localhost:8000/health   # {"device":"cuda", ...}
```
Expected: `device` が `cuda`、ワーカーが GPU を認識。

- [ ] **Step 2: 実 PDF で取り込み速度を確認**

CPU との所要時間を README のトラブルシュートに記録。MinerU が GPU を使うことを確認。

- [ ] **Step 3: 必要なら微調整をコミット**

```bash
git add docker-compose.gpu.yml
git commit -m "fix: GPU プロファイルの起動設定を調整"
```

---

### Task 6: E2E（Playwright・最小）

**Files:**
- Create: `playwright.config.ts`, `tests-e2e/rag-flow.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Playwright を追加**

Run: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`
`package.json` に `"e2e": "playwright test"`。

- [ ] **Step 2: 最小フローの spec**

`playwright.config.ts`（`webServer` で `pnpm dev` を起動、`baseURL: http://localhost:3000`）と `tests-e2e/rag-flow.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

// 前提: docker compose up -d（rag-worker 含む）が起動済み
test("register → upload → ask → cited answer", async ({ page }) => {
  await page.goto("/");
  // 新規登録（UI のセレクタは実装に合わせて調整）
  // ... ログイン/登録フォーム入力 ...
  // ファイルアップロード（小さな PDF を fixtures に用意）
  await page.setInputFiles('input[type="file"]', "tests-e2e/fixtures/sample.pdf");
  await expect(page.getByText(/索引化しました|ready/i)).toBeVisible({ timeout: 120_000 });
  // 質問
  await page.getByRole("textbox").fill("この資料の要点は？");
  await page.keyboard.press("Enter");
  // 引用付き回答
  await expect(page.locator("text=/\\[1\\]/")).toBeVisible({ timeout: 60_000 });
});
```
> セレクタは実 UI に合わせて調整。fixtures に軽量 PDF を置く。

- [ ] **Step 3: 実行（任意・要バックエンド起動）**

Run: `pnpm e2e`
Expected: フローが通る（CPU では時間がかかる）。

- [ ] **Step 4: コミット**

```bash
git add playwright.config.ts tests-e2e package.json pnpm-lock.yaml
git commit -m "test: アップロード→質問→引用の E2E を追加"
```

---

### Task 7: ドキュメント整備

**Files:**
- Modify: `README.md`, `.env.example`

- [ ] **Step 1: README を更新**

`README.md` の「技術スタック」「アーキテクチャ」「起動」を実構成に更新:
- バックエンド構成図（web / rag / postgres / qdrant / redis）
- 起動手順: `cp .env.example .env.local` → `docker compose up -d` → `pnpm install && pnpm dev`、マイグレーション（`pnpm drizzle-kit migrate`, `cd rag && uv run alembic upgrade head`）
- GPU 起動: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`
- 環境変数表（README 共通規約と一致させる）
- トラブルシュート（MinerU の CPU 遅延、モデル初回ダウンロード、GPU 認識）

- [ ] **Step 2: `.env.example` の最終化**

すべての変数（web: DATABASE_URL/RAG_SERVICE_URL/RAG_INTERNAL_TOKEN/ARAG_JWT_SECRET/ANTHROPIC_API_KEY、参考として rag 側の DEVICE/EMBEDDER/RERANKER）を説明コメント付きで記載。

- [ ] **Step 3: コミット**

```bash
git add README.md .env.example
git commit -m "docs: バックエンド実装に合わせて README/.env.example を更新"
```

---

## フェーズ6 完了条件
- `/health` が device とモデルロード状態を返し、compose healthcheck が通る
- 取り込み失敗を UI から再試行できる
- rag 不達・0 件のフォールバックがテストで固定
- （GPU 環境）GPU プロファイルで起動・高速化を確認
- README/.env.example が実構成に一致
- 全テスト green（`pnpm test` / `cd rag && uv run pytest`）、`pnpm lint` クリーン
