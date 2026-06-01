# 待機中アップロード取り消し機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 待機中（`queued`）の文書アップロードをサーバ側で安全に取り消せるようにし、アップロード送信中（`uploading`）も中断できるようにする。

**Architecture:** retry と対称な `POST /jobs/{job_id}/cancel` を新設し、`status='queued'` の行だけを原子的に DELETE して Document・生ファイルも削除する。Worker は doc/job 不在時に例外でなく no-op で終える。フロントは `queued` 状態を可視化し、✕ を状態で出し分ける（queued=取り消しAPI / uploading=POST abort / processing=不可）。

**Tech Stack:** FastAPI + SQLAlchemy（rag/）、Next.js App Router + React hooks + TypeScript（src/）、pytest（rag テスト）、vitest（フロント unit）。

設計: `docs/superpowers/specs/2026-06-02-arag-queued-upload-cancel-design.md`

---

## ファイル構成

- `rag/app/routers/documents.py` — `cancel_job` エンドポイント追加（修正）
- `rag/app/worker.py` — `run_ingest` の不在ガードを raise→return（修正）
- `rag/tests/test_documents_cancel_api.py` — cancel API テスト（新規）
- `rag/tests/test_worker_cancel_guard.py` — Worker ガードテスト（新規）
- `src/app/api/uploads/[id]/cancel/route.ts` — rag への中継ルート（新規）
- `src/lib/types.ts` — `UploadStatus` に `queued` 追加（修正）
- `src/hooks/use-uploads.ts` — `queued` マッピング・POST後の状態・abort・cancel 呼び出し・`uploadActionFor` export（修正）
- `src/hooks/use-uploads.test.ts` — `uploadActionFor` の unit テスト（新規）
- `src/components/uploads/uploads.tsx` — ✕ の状態別出し分け・待機中表示（修正）

---

## Task 1: バックエンド — `cancel_job` エンドポイント

**Files:**
- Modify: `rag/app/routers/documents.py`（`retry_job` の後ろ、`delete_document` の前あたりに追加）
- Test: `rag/tests/test_documents_cancel_api.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_cancel_api.py` を新規作成:

```python
from app.config import settings
from app.routers import documents as documents_router


def test_cancel_requires_token(client):
    res = client.post("/jobs/j1/cancel?owner_user_id=u1")
    assert res.status_code == 401


def _install_fakes(monkeypatch, *, owner="u1", status="queued", job_exists=True):
    state = {"deleted_jobs": 0, "doc_deleted": False, "files": None}

    class _Job:
        id = "j1"
        document_id = "d1"
        owner_user_id = owner
        status = "queued"

    class _Doc:
        id = "d1"
        owner_user_id = owner
        raw_path = "/u/d1.pdf"

    job = _Job()
    job.status = status

    class _DeleteQuery:
        def filter(self, *a, **k):
            return self

        def delete(self):
            # status が queued のときだけ削除成功（原子ガードの模倣）
            if job.status == "queued":
                state["deleted_jobs"] = 1
                return 1
            return 0

    class _Session:
        def get(self, model, _id):
            if model is documents_router.IngestJob:
                return job if job_exists else None
            return _Doc()

        def query(self, model):
            return _DeleteQuery()

        def delete(self, obj):
            state["doc_deleted"] = True

        def rollback(self):
            pass

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "cleanup_document_files",
                        lambda raw, md=None: state.update(files=(raw, md)))
    return state


def test_cancel_queued_deletes_job_doc_and_files(client, monkeypatch):
    state = _install_fakes(monkeypatch, status="queued")
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 204
    assert state["deleted_jobs"] == 1
    assert state["doc_deleted"] is True
    assert state["files"] == ("/u/d1.pdf", None)


def test_cancel_409_when_not_queued(client, monkeypatch):
    _install_fakes(monkeypatch, status="parsing")
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 409


def test_cancel_404_when_not_owner(client, monkeypatch):
    _install_fakes(monkeypatch, owner="owner-A")
    res = client.post("/jobs/j1/cancel?owner_user_id=intruder-B",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404


def test_cancel_404_when_job_missing(client, monkeypatch):
    _install_fakes(monkeypatch, job_exists=False)
    res = client.post("/jobs/j1/cancel?owner_user_id=u1",
                      headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
```

- [ ] **Step 2: テストを走らせ失敗を確認**

Run: `cd rag && pytest tests/test_documents_cancel_api.py -v`
Expected: FAIL（`/jobs/j1/cancel` が 404 ルート未定義、または token テスト以外が失敗）

- [ ] **Step 3: 最小実装を書く**

`rag/app/routers/documents.py` の `retry_job` 定義の直後に追加（`Response` は既に import 済み、`IngestStarted` 等と同様 `IngestJob`/`Document`/`cleanup_document_files` も import 済み）:

```python
@router.post("/jobs/{job_id}/cancel", status_code=204,
             dependencies=[Depends(require_internal_token)])
def cancel_job(job_id: str, owner_user_id: str | None = None):
    """待機中(queued)ジョブの取り消し。行と生ファイルを削除する。
    queued 以外は 409。Worker 着手との競合は status 条件付き DELETE で原子化。"""
    session = SessionLocal()
    raw_path: str | None = None
    try:
        job = session.get(IngestJob, job_id)
        if not job or (owner_user_id is not None and job.owner_user_id != owner_user_id):
            raise HTTPException(status_code=404, detail="job not found")
        if job.status != "queued":
            raise HTTPException(status_code=409, detail=f"job is {job.status}, cannot cancel")
        doc = session.get(Document, job.document_id)
        raw_path = doc.raw_path if doc else None
        # status='queued' の行だけを原子的に削除。0件なら Worker が着手済みなので 409。
        deleted = (
            session.query(IngestJob)
            .filter(IngestJob.id == job_id, IngestJob.status == "queued")
            .delete()
        )
        if not deleted:
            session.rollback()
            raise HTTPException(status_code=409, detail="job is no longer queued, cannot cancel")
        if doc:
            session.delete(doc)
        session.commit()
    finally:
        session.close()
    if raw_path:
        cleanup_document_files(raw_path, None)
    return Response(status_code=204)
```

- [ ] **Step 4: テストを走らせ通過を確認**

Run: `cd rag && pytest tests/test_documents_cancel_api.py -v`
Expected: PASS（5件）

- [ ] **Step 5: コミット**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_cancel_api.py
git commit -m "feat: 待機中ジョブのキャンセルAPIを追加"
```

---

## Task 2: バックエンド — Worker の不在ガードを no-op に

**Files:**
- Modify: `rag/app/worker.py:50-53`（`run_ingest` 冒頭）
- Test: `rag/tests/test_worker_cancel_guard.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_worker_cancel_guard.py` を新規作成:

```python
from app.worker import run_ingest


class _EmptySession:
    """get が常に None を返す（= キャンセルで行が消えた状態）。"""
    def get(self, model, _id):
        return None


class _BoomStore:
    def ensure_collection(self):
        raise AssertionError("store に触れてはいけない（早期 return すべき）")


def test_run_ingest_noop_when_doc_or_job_missing():
    # doc/job が無いとき run_ingest は例外を投げず、処理にも入らず終わる。
    run_ingest(_EmptySession(), _BoomStore(), embedder=None,
               parse_fn=None, document_id="gone", job_id="gone")
```

- [ ] **Step 2: テストを走らせ失敗を確認**

Run: `cd rag && pytest tests/test_worker_cancel_guard.py -v`
Expected: FAIL（現状は `RuntimeError: document or job not found` を送出）

- [ ] **Step 3: 最小実装を書く**

`rag/app/worker.py` の `run_ingest` 冒頭（現 50-53 行）を変更:

変更前:
```python
    doc = session.get(Document, document_id)
    job = session.get(IngestJob, job_id)
    if not doc or not job:
        raise RuntimeError(f"document or job not found: doc={document_id} job={job_id}")
```

変更後:
```python
    doc = session.get(Document, document_id)
    job = session.get(IngestJob, job_id)
    if not doc or not job:
        # キャンセル等で行が消えた後に Worker が拾った場合。エラーにせず no-op で終える。
        return
```

- [ ] **Step 4: テストを走らせ通過を確認**

Run: `cd rag && pytest tests/test_worker_cancel_guard.py tests/test_worker_pipeline.py -v`
Expected: PASS（新規テスト＋既存パイプラインテストが緑のまま）

- [ ] **Step 5: コミット**

```bash
git add rag/app/worker.py rag/tests/test_worker_cancel_guard.py
git commit -m "fix: キャンセル削除と着手の競合時に Worker を no-op 終了させる"
```

---

## Task 3: Next.js — cancel 中継ルート

**Files:**
- Create: `src/app/api/uploads/[id]/cancel/route.ts`

> 注: このルートはサーバ専用の薄い中継。frontend hook 経由でのみ叩かれ、自動テストは Task 5 のフックテストでカバーする（既存 retry ルートにも個別テストは無いため同方針）。検証は型チェックで行う。

- [ ] **Step 1: 実装を書く**

`src/app/api/uploads/[id]/cancel/route.ts` を新規作成（`retry/route.ts` と対称、204/404/409 を中継）:

```typescript
import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(
    `/jobs/${id}/cancel?owner_user_id=${encodeURIComponent(claims.sub)}`,
    { method: "POST" },
  );
  if (res.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (res.status === 409) return NextResponse.json({ error: "not cancellable" }, { status: 409 });
  if (!res.ok) return NextResponse.json({ error: "cancel failed" }, { status: 502 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: 型チェックで検証**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし（このファイル起因のエラーが出ない）

- [ ] **Step 3: コミット**

```bash
git add src/app/api/uploads/\[id\]/cancel/route.ts
git commit -m "feat: アップロード取り消しの中継APIルートを追加"
```

---

## Task 4: フロント — `queued` 状態の型と可視化

**Files:**
- Modify: `src/lib/types.ts:150`（`UploadStatus`）
- Modify: `src/hooks/use-uploads.ts`（`toUploadStatus`、POST 応答後の状態）

- [ ] **Step 1: `UploadStatus` に `queued` を追加**

`src/lib/types.ts` の該当行を変更:

変更前:
```typescript
export type UploadStatus = "uploading" | "processing" | "ready" | "error" | "skipped";
```

変更後:
```typescript
export type UploadStatus = "uploading" | "queued" | "processing" | "ready" | "error" | "skipped";
```

- [ ] **Step 2: `toUploadStatus` で queued を保持する**

`src/hooks/use-uploads.ts:17-22` を変更:

変更前:
```typescript
function toUploadStatus(s: string): UploadStatus {
  if (s === "ready") return "ready";
  if (s === "error") return "error";
  return "processing";
}
```

変更後:
```typescript
function toUploadStatus(s: string): UploadStatus {
  if (s === "ready") return "ready";
  if (s === "error") return "error";
  if (s === "queued") return "queued";
  return "processing";
}
```

- [ ] **Step 3: POST 応答後の状態を queued にする**

`src/hooks/use-uploads.ts:196` を変更（POST 成功直後はバックエンドが queued のため）:

変更前:
```typescript
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 10, jobId, documentId } : f)));
```

変更後:
```typescript
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "queued", progress: 0, jobId, documentId } : f)));
```

- [ ] **Step 4: 型チェックで検証**

Run: `pnpm exec tsc --noEmit`
Expected: `uploads.tsx` で `queued` 分岐が未処理でも型エラーにはならない（後続 Task で UI 追加）。このファイル起因の新規エラーが無いこと。

- [ ] **Step 5: コミット**

```bash
git add src/lib/types.ts src/hooks/use-uploads.ts
git commit -m "feat: 待機中(queued)アップロード状態を型と進捗マッピングに追加"
```

---

## Task 5: フロント — abort と cancel 呼び出し（`removeFile`）

**Files:**
- Modify: `src/hooks/use-uploads.ts`（`uploadActionFor` export、upload に AbortController、`removeFile` の分岐）
- Test: `src/hooks/use-uploads.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`src/hooks/use-uploads.test.ts` を新規作成（状態→操作種別の純関数をテスト）:

```typescript
import { expect, test } from "vitest";
import { uploadActionFor } from "@/hooks/use-uploads";

test("uploading は upload POST を中断する", () => {
  expect(uploadActionFor("uploading")).toBe("abort");
});

test("queued はサーバ側キャンセルAPIを呼ぶ", () => {
  expect(uploadActionFor("queued")).toBe("cancel");
});

test("processing は取り消し不可", () => {
  expect(uploadActionFor("processing")).toBe("none");
});

test("ready / error / skipped はローカル除去のみ", () => {
  expect(uploadActionFor("ready")).toBe("remove");
  expect(uploadActionFor("error")).toBe("remove");
  expect(uploadActionFor("skipped")).toBe("remove");
});
```

- [ ] **Step 2: テストを走らせ失敗を確認**

Run: `pnpm exec vitest --project unit run src/hooks/use-uploads.test.ts`
Expected: FAIL（`uploadActionFor` が export されていない）

- [ ] **Step 3: `uploadActionFor` を実装**

`src/hooks/use-uploads.ts` の `toUploadStatus` の近く（ファイル上部の純関数群）に追加:

```typescript
/** ✕ ボタンの操作種別を状態から決める。
 *  uploading=送信中POSTのabort / queued=サーバ側キャンセル / processing=不可 / それ以外=ローカル除去。 */
export function uploadActionFor(status: UploadStatus): "abort" | "cancel" | "none" | "remove" {
  if (status === "uploading") return "abort";
  if (status === "queued") return "cancel";
  if (status === "processing") return "none";
  return "remove";
}
```

- [ ] **Step 4: upload fetch に AbortController を付ける**

`src/hooks/use-uploads.ts` の `enqueue` 内、各ファイルの upload を中断可能にする。

(a) アップロード用 AbortController を id ごとに保持する ref を `streams` の隣（69-70 行付近）に追加:

```typescript
  const uploads = useRef<Record<string, AbortController>>({});
```

(b) `enqueue` の `fetch("/api/upload", ...)`（現 187 行）を AbortController 付きに変更:

変更前:
```typescript
        const form = new FormData();
        form.append("file", file);
        fetch("/api/upload", { method: "POST", body: form })
          .then(async (res) => {
            clearTimer(id);
```

変更後:
```typescript
        const form = new FormData();
        form.append("file", file);
        const uploadCtrl = new AbortController();
        uploads.current[id] = uploadCtrl;
        fetch("/api/upload", { method: "POST", body: form, signal: uploadCtrl.signal })
          .then(async (res) => {
            clearTimer(id);
            delete uploads.current[id];
```

(c) `.catch` 側（現 199-202 行）で abort 由来のエラーは無視する:

変更前:
```typescript
          .catch(() => {
            clearTimer(id);
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
          });
```

変更後:
```typescript
          .catch((err) => {
            clearTimer(id);
            delete uploads.current[id];
            if (uploadCtrl.signal.aborted) return; // ✕ による中断はエラー表示しない
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
          });
```

- [ ] **Step 5: `removeFile` を状態で分岐させる**

`src/hooks/use-uploads.ts:146-150` を変更:

変更前:
```typescript
  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    clearTimer(id);
    clearStream(id);
  }, [clearTimer, clearStream]);
```

変更後:
```typescript
  const removeFile = useCallback((id: string) => {
    const file = filesRef.current.find((f) => f.id === id);
    const action = file ? uploadActionFor(file.status) : "remove";

    // processing は取り消し不可（✕ は出さないが、保険でここでも no-op）。
    if (action === "none") return;

    // uploading: 送信中の upload POST を中断してから除去。
    if (action === "abort") {
      uploads.current[id]?.abort();
      delete uploads.current[id];
    }

    // queued: サーバ側キャンセルAPIを呼ぶ。成功で除去、409 は処理中として残す。
    if (action === "cancel" && file?.jobId) {
      const jobId = file.jobId;
      fetch(`/api/uploads/${jobId}/cancel`, { method: "POST" })
        .then((res) => {
          if (res.status === 409) {
            onToastRef.current?.("処理中のため取り消せません", "info");
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing" } : f)));
            return;
          }
          if (!res.ok) {
            onToastRef.current?.("取り消しに失敗しました", "error");
            return;
          }
          clearTimer(id);
          clearStream(id);
          setFiles((prev) => prev.filter((f) => f.id !== id));
        })
        .catch(() => onToastRef.current?.("取り消しに失敗しました", "error"));
      return;
    }

    // abort / remove: ローカル除去。
    setFiles((prev) => prev.filter((f) => f.id !== id));
    clearTimer(id);
    clearStream(id);
  }, [clearTimer, clearStream]);
```

- [ ] **Step 6: テストを走らせ通過を確認**

Run: `pnpm exec vitest --project unit run src/hooks/use-uploads.test.ts`
Expected: PASS（4件）

- [ ] **Step 7: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: このファイル起因の新規エラー無し（`UploadStatus` は import 済み）

- [ ] **Step 8: コミット**

```bash
git add src/hooks/use-uploads.ts src/hooks/use-uploads.test.ts
git commit -m "feat: アップロードの状態別取り消し（abort/キャンセルAPI）を実装"
```

---

## Task 6: フロント — ✕ の出し分けと待機中表示

**Files:**
- Modify: `src/components/uploads/uploads.tsx`（`AttachmentChip`）

- [ ] **Step 1: 待機中の状態表示を追加**

`src/components/uploads/uploads.tsx` の `AttachmentChip` 内、`file.status === "uploading"` ブロック（77-82 行）の直後に queued 表示を追加:

```tsx
          {file.status === "queued" && (
            <>
              <span className="h-[9px] w-[9px] shrink-0 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
              <span>待機中…</span>
            </>
          )}
```

- [ ] **Step 2: ✕ を状態で出し分ける**

`uploads.tsx` 冒頭の import に `uploadActionFor` を追加:

変更前:
```tsx
import type { IngestStage, StagedFile } from "@/lib/types";
```

変更後:
```tsx
import { uploadActionFor } from "@/hooks/use-uploads";
import type { IngestStage, StagedFile } from "@/lib/types";
```

`AttachmentChip` の ✕ ボタン（130-138 行）を、取り消し可能な状態のときだけ表示するよう変更。processing は出さない。

変更前:
```tsx
      <button
        className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
        onClick={() => onRemove(file.id)}
        aria-label="削除"
      >
        <svg viewBox="0 0 12 12" width="10" height="10">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>
```

変更後:
```tsx
      {uploadActionFor(file.status) !== "none" && (
        <button
          className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
          onClick={() => onRemove(file.id)}
          aria-label={uploadActionFor(file.status) === "remove" ? "削除" : "取り消し"}
        >
          <svg viewBox="0 0 12 12" width="10" height="10">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      )}
```

- [ ] **Step 3: 型チェックと lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 新規エラー無し

- [ ] **Step 4: 既存フロント unit テストの回帰確認**

Run: `pnpm test`
Expected: 全て PASS（既存テスト＋ Task 5 の use-uploads.test.ts）

- [ ] **Step 5: コミット**

```bash
git add src/components/uploads/uploads.tsx
git commit -m "feat: 待機中表示と状態別の取り消しボタンを追加"
```

---

## Task 7: 統合確認（手動）

**Files:** なし（動作確認のみ）

- [ ] **Step 1: rag を再ビルドして起動**

> rag は焼き込み Docker イメージ（ソースマウントなし）。`worker.py`/`documents.py` の変更を反映するには再ビルドが必須。

Run: `docker compose up -d --build rag rag-worker`
Expected: 両コンテナが healthy

- [ ] **Step 2: rag テスト全体を流す**

Run: `cd rag && pytest -q`
Expected: 全て PASS

- [ ] **Step 3: アプリでの目視確認**

1. 複数ファイルを一度にアップロードし、2件目以降が「待機中…」表示になることを確認（`max_jobs=1` のため滞留する）。
2. 待機中ファイルの ✕（取り消し）を押す → キューから消え、後で文書ライブラリにも現れないことを確認。
3. 処理中（解析中…等）のファイルには ✕ が出ないことを確認。
4. 大きめファイルのアップロード送信中に ✕ → 中断され、索引化が始まらないことを確認。

- [ ] **Step 4: 最終確認のコミット（必要なら）**

確認のみで変更が無ければスキップ。

---

## 自己レビュー結果（spec 対応）

- 待機中の原子的キャンセルAPI（spec §4）→ Task 1
- Worker の no-op ガード（spec §4）→ Task 2
- 中継ルート（spec §5）→ Task 3
- `queued` 可視化・状態マッピング（spec §1）→ Task 4
- uploading の abort（spec §3）→ Task 5
- ✕ の状態別出し分け（spec §2）→ Task 5/6
- テスト（spec §テスト）→ Task 1/2/5、回帰は Task 6/7
- rag 再ビルド必須（プロジェクト規約）→ Task 7
