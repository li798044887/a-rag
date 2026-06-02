# アップロード文書のまとめて削除 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文書管理モーダルで複数文書を選択し、rag の一括削除 API でまとめて削除できるようにする。

**Architecture:** rag 側は単一削除の本体を `_delete_one` ヘルパーに切り出して再利用し、`POST /documents/bulk-delete` を新設（部分成功を 200+JSON で返す）。Next.js は中継ルートを追加。フロントは `useDocuments` に選択状態と `removeMany`（楽観更新＋失敗ロールバック）を持たせ、`DocumentsModal` に選択モードのトグル UI を足す。

**Tech Stack:** FastAPI / SQLAlchemy / pytest（rag）、Next.js App Router / React / TypeScript / vitest（フロント）。

参照スペック: `docs/superpowers/specs/2026-06-02-arag-bulk-delete-documents-design.md`

---

## ファイル構成

- `rag/app/schemas.py` — `BulkDeleteRequest` / `BulkDeleteResponse` を追加（Modify）
- `rag/app/routers/documents.py` — `_delete_one` 抽出、`delete_document` を書き換え、`POST /documents/bulk-delete` を追加（Modify）
- `rag/tests/test_documents_bulk_delete_api.py` — 一括削除のテスト（Create）
- `src/app/api/documents/bulk-delete/route.ts` — 中継ルート（Create）
- `src/hooks/use-documents.ts` — `removeByIds` 純関数＋選択状態＋`removeMany`（Modify）
- `src/hooks/use-documents.test.ts` — `removeByIds` のテストを追記（Modify）
- `src/components/documents/documents-modal.tsx` — 選択モード UI（Modify）

---

## 重要な前提（既存パターン）

- rag ルータは `from app.models import Chunk, Document, IngestJob` 済み。`cleanup_document_files`・`record_workspace_activity`・`QdrantStore` も import 済み（`documents.py:1-26`）。
- 既存の単一削除 `delete_document`（`documents.py:208-227`）の処理順: `raw_path/parsed_md_path` 取得 → `QdrantStore().delete_by_document` → `Chunk` 削除 → `IngestJob` 削除 → `session.delete(doc)` → `record_workspace_activity` → `commit` → `cleanup_document_files`。
- rag テストは共有 dev Postgres を触るものもあるが、本プランの API テストは `monkeypatch` でセッション/Qdrant/ファイル削除を差し替えるユニットテスト（DB 非依存）。`conftest.py` の `client` フィクスチャと `settings.rag_internal_token` を使う（`test_documents_delete_api.py` と同形）。
- Next.js 中継ルートは `getSessionClaims`（`@/lib/auth`）と `ragFetch`（`@/lib/rag-client`）を使う（`src/app/api/documents/[id]/route.ts` 参照）。`claims.sub` が owner。

---

### Task 1: rag バックエンド — `_delete_one` 抽出 ＋ `POST /documents/bulk-delete`

**Files:**
- Modify: `rag/app/schemas.py`
- Modify: `rag/app/routers/documents.py`（`_delete_one` 追加、`delete_document` 書き換え `:208-227`、新エンドポイント追加）
- Test: `rag/tests/test_documents_bulk_delete_api.py`

- [ ] **Step 1: スキーマを追加**

`rag/app/schemas.py` の末尾に追記:

```python
class BulkDeleteRequest(BaseModel):
    owner_user_id: str
    document_ids: list[str]


class BulkDeleteResponse(BaseModel):
    deleted: list[str]
    not_found: list[str]
```

- [ ] **Step 2: 失敗するテストを書く**

`rag/tests/test_documents_bulk_delete_api.py` を新規作成:

```python
from app.config import settings
from app.routers import documents as documents_router


def test_bulk_delete_requires_token(client):
    res = client.post("/documents/bulk-delete",
                      json={"owner_user_id": "u1", "document_ids": ["d1"]})
    assert res.status_code == 401


def _install_fakes(monkeypatch, owners):
    """owners: dict id -> owner_user_id（存在しない id はマップに入れない）。"""
    state = {"vectors": [], "Chunk": 0, "IngestJob": 0,
             "docs_deleted": [], "files": [], "activity": 0}

    class _Doc:
        def __init__(self, doc_id, owner):
            self.id = doc_id
            self.owner_user_id = owner
            self.raw_path = f"/u/{doc_id}.pdf"
            self.parsed_md_path = None

    class _Query:
        def __init__(self, model):
            self.model = model

        def filter(self, *a, **k):
            return self

        def delete(self):
            state[self.model.__name__] += 1
            return 1

    class _Session:
        def get(self, model, doc_id):
            owner = owners.get(doc_id)
            return _Doc(doc_id, owner) if owner is not None else None

        def query(self, model):
            return _Query(model)

        def delete(self, obj):
            state["docs_deleted"].append(obj.id)

        def commit(self):
            pass

        def close(self):
            pass

    class _Qdrant:
        def delete_by_document(self, doc_id):
            state["vectors"].append(doc_id)

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "QdrantStore", lambda *a, **k: _Qdrant())
    monkeypatch.setattr(documents_router, "cleanup_document_files",
                        lambda raw, md=None: state["files"].append((raw, md)))
    monkeypatch.setattr(documents_router, "record_workspace_activity",
                        lambda session, *, owner_user_id: state.update(activity=state["activity"] + 1))
    return state


def test_bulk_delete_removes_owned_and_reports_missing(client, monkeypatch):
    # d1,d2 は u1 所有、d3 は不在、d4 は別人所有
    state = _install_fakes(monkeypatch, {"d1": "u1", "d2": "u1", "d4": "owner-B"})
    res = client.post("/documents/bulk-delete",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "u1",
                            "document_ids": ["d1", "d2", "d3", "d4"]})
    assert res.status_code == 200
    body = res.json()
    assert body["deleted"] == ["d1", "d2"]
    assert body["not_found"] == ["d3", "d4"]
    assert state["vectors"] == ["d1", "d2"]
    assert state["Chunk"] == 2
    assert state["IngestJob"] == 2
    assert state["docs_deleted"] == ["d1", "d2"]
    assert state["files"] == [("/u/d1.pdf", None), ("/u/d2.pdf", None)]
    assert state["activity"] == 1


def test_bulk_delete_empty_list_is_noop(client, monkeypatch):
    state = _install_fakes(monkeypatch, {})
    res = client.post("/documents/bulk-delete",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "u1", "document_ids": []})
    assert res.status_code == 200
    assert res.json() == {"deleted": [], "not_found": []}
    assert state["activity"] == 0
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `docker compose exec rag pytest tests/test_documents_bulk_delete_api.py -v`
（rag コンテナ前提。ローカル venv なら `cd rag && pytest tests/test_documents_bulk_delete_api.py -v`）
Expected: FAIL（`/documents/bulk-delete` 未定義のため 404、または import エラー）

- [ ] **Step 4: `_delete_one` を追加し `delete_document` を書き換える**

`rag/app/routers/documents.py`、既存 `delete_document`（`:208-227`）を次に置き換える:

```python
def _delete_one(session, doc) -> tuple[str | None, str | None]:
    """1文書の Qdrant ベクトル/chunks/job/行を削除し、cleanup 対象の生ファイルパスを返す。
    commit と cleanup_document_files は呼び出し側で行う。"""
    raw_path, parsed_md_path = doc.raw_path, doc.parsed_md_path
    QdrantStore().delete_by_document(doc.id)
    session.query(Chunk).filter(Chunk.document_id == doc.id).delete()
    session.query(IngestJob).filter(IngestJob.document_id == doc.id).delete()
    session.delete(doc)
    return raw_path, parsed_md_path


@router.delete("/documents/{document_id}", status_code=204,
               dependencies=[Depends(require_internal_token)])
def delete_document(document_id: str, owner_user_id: str):
    session = SessionLocal()
    raw_path: str | None = None
    parsed_md_path: str | None = None
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path, parsed_md_path = _delete_one(session, doc)
        record_workspace_activity(session, owner_user_id=owner_user_id)
        session.commit()
    finally:
        session.close()
    cleanup_document_files(raw_path, parsed_md_path)
    return Response(status_code=204)
```

- [ ] **Step 5: bulk-delete エンドポイントを追加**

同ファイルの `delete_document` の直後に追加し、`schemas` の import に `BulkDeleteRequest, BulkDeleteResponse` を加える（`documents.py:20-23` の import 文に追記）:

```python
@router.post("/documents/bulk-delete", response_model=BulkDeleteResponse,
             dependencies=[Depends(require_internal_token)])
def bulk_delete_documents(req: BulkDeleteRequest):
    """複数文書をまとめて削除する。所有者不一致・不在は not_found に入れて部分成功を許容。"""
    session = SessionLocal()
    deleted: list[str] = []
    not_found: list[str] = []
    files: list[tuple[str | None, str | None]] = []
    try:
        for doc_id in req.document_ids:
            doc = session.get(Document, doc_id)
            if not doc or doc.owner_user_id != req.owner_user_id:
                not_found.append(doc_id)
                continue
            files.append(_delete_one(session, doc))
            deleted.append(doc_id)
        if deleted:
            record_workspace_activity(session, owner_user_id=req.owner_user_id)
        session.commit()
    finally:
        session.close()
    for raw, md in files:
        cleanup_document_files(raw, md)
    return BulkDeleteResponse(deleted=deleted, not_found=not_found)
```

import 文の修正後の形（`documents.py:20-23`）:

```python
from app.schemas import (
    BulkDeleteRequest, BulkDeleteResponse,
    DocumentListResponse, FetchDocumentRequest, FetchDocumentResponse, FetchedChunk, IngestStarted,
    WorkspaceStats,
)
```

- [ ] **Step 6: テストが通ることを確認**

Run: `docker compose exec rag pytest tests/test_documents_bulk_delete_api.py tests/test_documents_delete_api.py -v`
Expected: PASS（新規 3 テスト＋既存 delete テストが緑。`_delete_one` 抽出で単一削除も不変）

- [ ] **Step 7: コミット**

```bash
git add rag/app/schemas.py rag/app/routers/documents.py rag/tests/test_documents_bulk_delete_api.py
git commit -m "feat: 文書の一括削除APIを追加し単一削除と処理を共通化"
```

---

### Task 2: Next.js 中継ルート `POST /api/documents/bulk-delete`

**Files:**
- Create: `src/app/api/documents/bulk-delete/route.ts`

- [ ] **Step 1: 中継ルートを実装**

`src/app/api/documents/bulk-delete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.document_ids) ? (body.document_ids as unknown[]) : null;
  if (!ids) return NextResponse.json({ error: "document_ids required" }, { status: 400 });
  const documentIds = ids.filter((x): x is string => typeof x === "string");

  const res = await ragFetch("/documents/bulk-delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_user_id: claims.sub, document_ids: documentIds }),
  });
  if (!res.ok) return NextResponse.json({ error: "bulk delete failed" }, { status: 502 });
  const json = await res.json();
  return NextResponse.json(json, { status: 200 });
}
```

- [ ] **Step 2: 型チェックと lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/app/api/documents/bulk-delete/route.ts`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/app/api/documents/bulk-delete/route.ts
git commit -m "feat: 一括削除の中継APIルートを追加"
```

---

### Task 3: `useDocuments` — `removeByIds` 純関数 ＋ 選択状態 ＋ `removeMany`

**Files:**
- Modify: `src/hooks/use-documents.ts`
- Test: `src/hooks/use-documents.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/hooks/use-documents.test.ts` に追記（既存の `doc` ヘルパーと import を流用、`removeByIds` を import に追加）:

```ts
import { mergeNextPage, removeByIds } from "@/hooks/use-documents";

test("removeByIds drops matching ids and counts removals", () => {
  const items = [doc("a"), doc("b"), doc("c")];
  const { items: next, removed } = removeByIds(items, ["a", "c", "zzz"]);
  expect(next.map((d) => d.id)).toEqual(["b"]);
  expect(removed).toBe(2);
});
```

1 行目の import 文は既存の `import { mergeNextPage } from "@/hooks/use-documents";` を上記に置き換える。

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/hooks/use-documents.test.ts`
Expected: FAIL（`removeByIds` is not exported）

- [ ] **Step 3: `removeByIds` 純関数を追加**

`src/hooks/use-documents.ts` の `mergeNextPage` の直後に追加:

```ts
/** items から ids に一致する文書を除去し、除去件数も返す純粋関数。 */
export function removeByIds(items: DocumentSummary[], ids: string[]): { items: DocumentSummary[]; removed: number } {
  const idSet = new Set(ids);
  const next = items.filter((d) => !idSet.has(d.id));
  return { items: next, removed: items.length - next.length };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/hooks/use-documents.test.ts`
Expected: PASS（2 テストとも緑）

- [ ] **Step 5: 選択状態と `removeMany` をフックに追加**

`src/hooks/use-documents.ts` の `useDocuments` 内に state を追加（既存 state 群の直後）:

```ts
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
```

`remove` の定義の直後に以下を追加:

```ts
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const selectAllVisible = useCallback(() => setSelectedIds(new Set(items.map((d) => d.id))), [items]);
  const enterSelection = useCallback(() => setSelectionMode(true), []);
  const exitSelection = useCallback(() => { setSelectionMode(false); setSelectedIds(new Set()); }, []);

  const removeMany = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const prev = items;
    const prevTotal = total;
    const { items: next, removed } = removeByIds(items, ids);
    setItems(next);
    setTotal((t) => Math.max(0, t - removed));
    const r = await fetch("/api/documents/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document_ids: ids }),
    }).catch(() => null);
    if (!r || !r.ok) {
      setItems(prev);
      setTotal(prevTotal);
      onToastRef.current?.("削除に失敗しました", "error");
      return;
    }
    onToastRef.current?.(`${removed}件の文書を削除しました`, "success");
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [items, total]);
```

`allVisibleSelected` 派生値を return 直前に追加:

```ts
  const allVisibleSelected = items.length > 0 && items.every((d) => selectedIds.has(d.id));
```

return オブジェクトに追加（既存の `setQuery, setStatusFilter, load, loadMore, remove, retry,` の行に続けて）:

```ts
    selectionMode, selectedIds, allVisibleSelected,
    enterSelection, exitSelection, toggleSelect, clearSelection, selectAllVisible, removeMany,
```

- [ ] **Step 6: 型チェック・lint・テスト**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/hooks/use-documents.ts && pnpm exec vitest run src/hooks/use-documents.test.ts`
Expected: エラーなし、テスト PASS

- [ ] **Step 7: コミット**

```bash
git add src/hooks/use-documents.ts src/hooks/use-documents.test.ts
git commit -m "feat: useDocuments に選択状態と一括削除を追加"
```

---

### Task 4: `DocumentsModal` — 選択モード UI

**Files:**
- Modify: `src/components/documents/documents-modal.tsx`

- [ ] **Step 1: フックの戻り値を分解で受け取る**

`src/components/documents/documents-modal.tsx:96` の `const docs = useDocuments(open, onToast);` はそのまま使い、以下で `docs.selectionMode` 等を参照する（追加の分解は不要）。

- [ ] **Step 2: 一括削除ハンドラを追加**

`onDelete`（`:167-178`）の直後に追加:

```tsx
  const onBulkDelete = async () => {
    const ids = [...docs.selectedIds];
    if (!ids.length) return;
    const ok = await confirm({
      title: `選択した ${ids.length}件の文書を削除しますか？`,
      description: `選択した ${ids.length}件の文書と抽出データ・索引を完全に削除します。元に戻せません。`,
      confirmLabel: "削除する",
      tone: "danger",
    });
    if (!ok) return;
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    await docs.removeMany(ids);
    onChanged?.();
  };
```

- [ ] **Step 3: 「選択」ボタン → 選択ツールバーへ差し替え**

`:292-303` のフィルタチップの `<div className="flex flex-wrap gap-1">…</div>` ブロックを、選択モードで出し分ける形に置き換える:

```tsx
              {docs.selectionMode ? (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg">
                    <input
                      type="checkbox"
                      checked={docs.allVisibleSelected}
                      onChange={(e) => (e.target.checked ? docs.selectAllVisible() : docs.clearSelection())}
                      className="accent-accent"
                    />
                    {docs.selectedIds.size}件選択中
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={onBulkDelete}
                      disabled={docs.selectedIds.size === 0}
                      className="rounded-md px-2 py-1 text-[12px] font-semibold text-[#B83A1F] hover:bg-[rgba(184,58,31,0.12)] disabled:opacity-40 disabled:hover:bg-transparent"
                    >削除</button>
                    <button
                      onClick={docs.exitSelection}
                      className="rounded-md px-2 py-1 text-[12px] font-medium text-muted hover:bg-divider hover:text-fg"
                    >キャンセル</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="flex flex-wrap gap-1">
                    {[["", "すべて"], ["ready", "索引済み"], ["error", "エラー"], ["processing", "処理中"]].map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => docs.setStatusFilter(v || null)}
                        className={cn(
                          "rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium transition-colors",
                          (docs.statusFilter ?? "") === v ? "border-accent bg-accent-soft text-accent" : "border-divider-strong bg-transparent text-muted hover:text-fg",
                        )}
                      >{label}</button>
                    ))}
                  </div>
                  <button
                    onClick={docs.enterSelection}
                    disabled={!docs.items.length}
                    className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium text-muted hover:bg-divider hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
                  >選択</button>
                </div>
              )}
```

- [ ] **Step 4: 一覧の行をチェックボックス対応にする**

`:306-334` の `docs.items.map((d) => { … })` 内の `<button>` を、選択モードでクリック挙動を変え、左端にチェックボックスを出すよう変更する。`<button onClick={() => selectDoc(d)} …>` の `onClick` を差し替え、アイコンの前にチェックボックスを挿入:

`onClick` を次に変更:

```tsx
                    onClick={() => (docs.selectionMode ? docs.toggleSelect(d.id) : selectDoc(d))}
```

選択状態のハイライトを既存 `className` の cn 内へ追加（`selectedId === d.id ? …` の条件に or で `docs.selectionMode && docs.selectedIds.has(d.id)` を加える）:

```tsx
                      (selectedId === d.id || (docs.selectionMode && docs.selectedIds.has(d.id))) ? "bg-surface-2 shadow-e1" : "hover:bg-divider",
```

アイコン `<span className="inline-flex h-7 w-7 …">`（`:317`）の直前にチェックボックスを挿入:

```tsx
                    {docs.selectionMode && (
                      <input
                        type="checkbox"
                        readOnly
                        checked={docs.selectedIds.has(d.id)}
                        className="shrink-0 accent-accent"
                      />
                    )}
```

（行全体の `onClick` で選択をトグルするため、チェックボックス自体は `readOnly` で見た目のみ。）

- [ ] **Step 5: 型チェックと lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/components/documents/documents-modal.tsx`
Expected: エラーなし

- [ ] **Step 6: ビルド確認**

Run: `pnpm exec next build`
Expected: 成功（型・ルート解決エラーなし）

- [ ] **Step 7: コミット**

```bash
git add src/components/documents/documents-modal.tsx
git commit -m "feat: 文書モーダルに選択モードとまとめて削除UIを追加"
```

---

## 手動確認（全タスク完了後）

1. `docker compose up -d` で起動し、文書モーダルを開く。
2. 「選択」を押す → 各行にチェックボックス、フィルタ行が選択ツールバーに変わる。
3. 複数選択 → 「N件選択中」が更新される。全選択チェックで表示中全件が入る。
4. 「削除」→ 確認ダイアログ → OK で一覧から消え「N件の文書を削除しました」トースト。
5. モーダルを開き直す（再取得）／ワークスペース統計（`onChanged`）が反映されることを確認。
6. ネットワークを切って削除 → 一覧が元に戻り「削除に失敗しました」トーストが出る（ロールバック）。
