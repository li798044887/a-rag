# 重複ファイルアップロードガード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一内容のファイルが同一ユーザー内で重複してアップロード・索引化されるのを、SHA-256 コンテンツハッシュで検知し 409 エラーで弾く。

**Architecture:** rag バックエンドの `create_document` でアップロードバイト列の SHA-256 を計算し `documents.content_hash` に保存。同一 `owner_user_id` かつ同一ハッシュで `status != 'error'` の行があれば 409。Postgres の部分ユニークインデックスを競合バックストップにする。Next `/api/upload` は 409 を日本語メッセージにマッピングし、既存フロントフックがそれを error 表示する（フックは無変更）。

**Tech Stack:** Python / FastAPI / SQLAlchemy / Alembic / Postgres（host:5433）、Next.js（Route Handler）、pytest、vitest。

**設計書:** `docs/superpowers/specs/2026-06-02-duplicate-upload-guard-design.md`

---

## ファイル構成

- Modify: `rag/app/models.py` — `Document` に `content_hash` 列を追加
- Create: `rag/alembic/versions/b7c4d9e1f2a3_document_content_hash.py` — 列・部分ユニークindex・バックフィル
- Modify: `rag/app/routers/documents.py:90-123` — `create_document` にハッシュ計算と重複検知
- Modify: `rag/tests/test_documents_api.py` — rag 側の重複ガードテスト
- Modify: `src/app/api/upload/route.ts:26-31` — rag 409 を 409+日本語メッセージにマッピング
- Create: `src/app/api/upload/upload.test.ts` — Next route の 409/502 マッピングテスト

### 前提コマンド（テスト実行環境）

rag の pytest は host:5433 の実 Postgres を使う（`rag/tests/conftest.py`）。Task 2 のマイグレーション適用後にテストが通る。

- rag テスト: `cd rag && uv run pytest tests/test_documents_api.py -v`
- マイグレーション（host の dev DB へ）: `cd rag && DATABASE_URL="postgresql+psycopg://arag:arag@localhost:5433/arag" uv run alembic upgrade head`
- 稼働中 docker スタックへ反映: `docker compose exec -T rag uv run alembic upgrade head`
- Next テスト: `pnpm vitest run src/app/api/upload/upload.test.ts`

---

## Task 1: Document モデルに content_hash 列を追加

**Files:**
- Modify: `rag/app/models.py:15-27`

- [ ] **Step 1: `Document` に列を追加**

`rag/app/models.py` の `Document` クラス、`raw_path` 行の直後（`parsed_md_path` の前あたり）に追加:

```python
    content_hash: Mapped[str | None] = mapped_column(String, nullable=True, index=False)
```

（`String` は既に import 済み。`Mapped` / `mapped_column` も既存。）

- [ ] **Step 2: import 確認**

Run: `cd rag && uv run python -c "from app.models import Document; print(Document.content_hash)"`
Expected: エラーなく `Document.content_hash` のカラム式が表示される。

- [ ] **Step 3: Commit**

```bash
git add rag/app/models.py
git commit -m "feat: Document に content_hash 列を追加"
```

---

## Task 2: Alembic マイグレーション（列・部分ユニークindex・バックフィル）

**Files:**
- Create: `rag/alembic/versions/b7c4d9e1f2a3_document_content_hash.py`

- [ ] **Step 1: マイグレーションファイルを作成**

`rag/alembic/versions/b7c4d9e1f2a3_document_content_hash.py`:

```python
"""document content_hash

Revision ID: b7c4d9e1f2a3
Revises: e2a9ffce7300
Create Date: 2026-06-02 00:00:00.000000

"""
import hashlib
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c4d9e1f2a3"
down_revision: Union[str, Sequence[str], None] = "e2a9ffce7300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("content_hash", sa.String(), nullable=True))

    # 既存行のバックフィル（ベストエフォート）: raw_path を読み SHA-256 を埋める。
    # ファイル不在・読込失敗はスキップして NULL のまま残す。
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, raw_path FROM documents")).fetchall()
    for row in rows:
        try:
            data = Path(row.raw_path).read_bytes()
        except OSError:
            continue
        digest = hashlib.sha256(data).hexdigest()
        bind.execute(
            sa.text("UPDATE documents SET content_hash = :h WHERE id = :id"),
            {"h": digest, "id": row.id},
        )

    # 同一ユーザー・同一内容で error 以外が同時に2行存在することを禁止する部分ユニークindex。
    op.create_index(
        "uq_documents_owner_hash_active",
        "documents",
        ["owner_user_id", "content_hash"],
        unique=True,
        postgresql_where=sa.text("content_hash IS NOT NULL AND status != 'error'"),
    )


def downgrade() -> None:
    op.drop_index("uq_documents_owner_hash_active", table_name="documents")
    op.drop_column("documents", "content_hash")
```

- [ ] **Step 2: マイグレーションを dev DB（5433）へ適用**

Run: `cd rag && DATABASE_URL="postgresql+psycopg://arag:arag@localhost:5433/arag" uv run alembic upgrade head`
Expected: `Running upgrade e2a9ffce7300 -> b7c4d9e1f2a3, document content_hash` が表示され、エラーなく完了。

- [ ] **Step 3: 列とindexが付与されたことを確認**

Run:
```bash
cd rag && DATABASE_URL="postgresql+psycopg://arag:arag@localhost:5433/arag" uv run python -c "
import sqlalchemy as sa
e = sa.create_engine('postgresql+psycopg://arag:arag@localhost:5433/arag')
with e.connect() as c:
    cols = [r[0] for r in c.execute(sa.text(\"SELECT column_name FROM information_schema.columns WHERE table_name='documents'\"))]
    idx = [r[0] for r in c.execute(sa.text(\"SELECT indexname FROM pg_indexes WHERE tablename='documents'\"))]
    print('content_hash' in cols, 'uq_documents_owner_hash_active' in idx)
"
```
Expected: `True True`

- [ ] **Step 4: downgrade/upgrade の往復を確認**

Run:
```bash
cd rag && DATABASE_URL="postgresql+psycopg://arag:arag@localhost:5433/arag" uv run alembic downgrade -1 && \
DATABASE_URL="postgresql+psycopg://arag:arag@localhost:5433/arag" uv run alembic upgrade head
```
Expected: downgrade で `b7c4d9e1f2a3 -> e2a9ffce7300`、続く upgrade で再度 head まで。エラーなし。

- [ ] **Step 5: Commit**

```bash
git add rag/alembic/versions/b7c4d9e1f2a3_document_content_hash.py
git commit -m "feat: documents.content_hash 列と部分ユニークindexを追加"
```

---

## Task 3: rag create_document に重複検知を実装

**Files:**
- Modify: `rag/app/routers/documents.py:1-22`（import 追加）, `:90-123`（ロジック）
- Test: `rag/tests/test_documents_api.py`

- [ ] **Step 1a: 既存テストの固定 owner/content を一意化する**

実 DB は行が永続するため、重複ガード導入後は固定 owner `"u1"` + 固定内容 `"hello"` の `test_upload_creates_doc_and_enqueues` が 2 回目の実行で 409 になり失敗する。owner と内容を実行ごとに一意化する。

`rag/tests/test_documents_api.py` の冒頭 import に追加:

```python
import uuid
```

`test_upload_creates_doc_and_enqueues` 内の owner と file content を一意化する。`data={"owner_user_id": "u1"}` を以下に変更:

```python
        data={"owner_user_id": f"u1-{uuid.uuid4().hex}"},
```

および `io.BytesIO(b"hello")` を以下に変更:

```python
        files={"file": ("a.pdf", io.BytesIO(uuid.uuid4().bytes), "application/pdf")},
```

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_api.py` の末尾に追加（`import uuid` は Step 1a で追加済みのため重複させない）:

```python


def _upload(client, owner, content, monkeypatch):
    async def fake_enqueue(document_id, job_id):
        pass
    monkeypatch.setattr("app.routers.documents.enqueue_ingest", fake_enqueue)
    return client.post(
        "/documents",
        headers={"x-internal-token": settings.rag_internal_token},
        files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")},
        data={"owner_user_id": owner},
    )


def test_duplicate_same_owner_rejected(client, monkeypatch):
    owner = f"dup-{uuid.uuid4().hex}"
    content = uuid.uuid4().bytes  # テストごとに一意な内容
    first = _upload(client, owner, content, monkeypatch)
    assert first.status_code == 200
    second = _upload(client, owner, content, monkeypatch)
    assert second.status_code == 409


def test_duplicate_different_owner_allowed(client, monkeypatch):
    content = uuid.uuid4().bytes
    a = _upload(client, f"a-{uuid.uuid4().hex}", content, monkeypatch)
    b = _upload(client, f"b-{uuid.uuid4().hex}", content, monkeypatch)
    assert a.status_code == 200 and b.status_code == 200


def test_duplicate_does_not_leave_orphan_file(client, monkeypatch):
    import os
    owner = f"dup-{uuid.uuid4().hex}"
    content = uuid.uuid4().bytes
    _upload(client, owner, content, monkeypatch)
    before = set(os.listdir(settings.upload_dir))
    second = _upload(client, owner, content, monkeypatch)
    assert second.status_code == 409
    after = set(os.listdir(settings.upload_dir))
    assert after == before  # 409 時に新しい生ファイルを残さない
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && uv run pytest tests/test_documents_api.py::test_duplicate_same_owner_rejected -v`
Expected: FAIL（2回目が 200 を返すため `assert second.status_code == 409` で失敗）。

- [ ] **Step 3: import を追加**

`rag/app/routers/documents.py` の先頭付近、`import uuid` の下に追加:

```python
import hashlib
```

`from fastapi import ...` 群の近くに追加:

```python
from sqlalchemy.exc import IntegrityError
```

- [ ] **Step 4: `create_document` を書き換える**

`rag/app/routers/documents.py` の `create_document`（現 `:90-123`）を以下に置き換える:

```python
@router.post("/documents", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def create_document(file: UploadFile = File(...), owner_user_id: str = Form(...)):
    upload_dir = _upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "file").name
    raw_path = upload_dir / f"{uuid.uuid4().hex}_{safe_name}"
    data = await file.read()
    content_hash = hashlib.sha256(data).hexdigest()
    raw_path.write_bytes(data)

    try:
        session = SessionLocal()
        try:
            # 同一ユーザー・同一内容で error 以外が既にあれば重複として弾く。
            existing = (
                session.query(Document)
                .filter(Document.owner_user_id == owner_user_id,
                        Document.content_hash == content_hash,
                        Document.status != "error")
                .first()
            )
            if existing:
                raise HTTPException(status_code=409, detail="duplicate document")
            doc = Document(owner_user_id=owner_user_id, filename=file.filename or "file",
                           mime=file.content_type or "application/octet-stream",
                           size=raw_path.stat().st_size, raw_path=str(raw_path),
                           content_hash=content_hash, status="queued")
            session.add(doc)
            session.flush()
            job = IngestJob(document_id=doc.id, owner_user_id=owner_user_id, status="queued")
            session.add(job)
            session.commit()
            result = IngestStarted(document_id=doc.id, job_id=job.id)
        finally:
            session.close()
    except HTTPException:
        raw_path.unlink(missing_ok=True)
        raise
    except IntegrityError:
        # 同時二重アップロードの競合: 部分ユニークindex違反を 409 に正規化。
        raw_path.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="duplicate document")
    except Exception:
        raw_path.unlink(missing_ok=True)
        raise

    try:
        await enqueue_ingest(result.document_id, result.job_id)
    except Exception as exc:  # noqa: BLE001
        _mark_enqueue_failed(result.document_id, result.job_id, f"enqueue failed: {exc}")
        raise HTTPException(status_code=502, detail="ingest enqueue failed") from exc

    return result
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_documents_api.py -v`
Expected: 既存テスト含め全て PASS（`test_duplicate_same_owner_rejected` / `test_duplicate_different_owner_allowed` / `test_duplicate_does_not_leave_orphan_file` が PASS）。

- [ ] **Step 6: Commit**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_api.py
git commit -m "feat: 同一内容ファイルの重複アップロードを409で弾く"
```

---

## Task 4: Next /api/upload で 409 をマッピング

**Files:**
- Modify: `src/app/api/upload/route.ts:26-31`
- Test: `src/app/api/upload/upload.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/app/api/upload/upload.test.ts`:

```typescript
import { expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionClaims: vi.fn(() => Promise.resolve({ sub: "u1" })),
}));

const ragFetch = vi.fn();
vi.mock("@/lib/rag-client", () => ({
  ragFetch: (...args: unknown[]) => ragFetch(...args),
}));

import { POST } from "@/app/api/upload/route";

function uploadRequest() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "a.pdf", { type: "application/pdf" }));
  return new Request("http://x/api/upload", { method: "POST", body: form });
}

beforeEach(() => ragFetch.mockReset());

test("maps rag 409 to 409 with Japanese duplicate message", async () => {
  ragFetch.mockResolvedValue(new Response("dup", { status: 409 }));
  const res = await POST(uploadRequest());
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toContain("同じ内容のファイル");
});

test("maps other rag failure to 502", async () => {
  ragFetch.mockResolvedValue(new Response("err", { status: 500 }));
  const res = await POST(uploadRequest());
  expect(res.status).toBe(502);
});

test("returns ids on success", async () => {
  ragFetch.mockResolvedValue(
    new Response(JSON.stringify({ document_id: "d1", job_id: "j1" }), { status: 200 }),
  );
  const res = await POST(uploadRequest());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ documentId: "d1", jobId: "j1" });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/app/api/upload/upload.test.ts`
Expected: `maps rag 409 to 409 ...` が FAIL（現状 409 を 502 にしているため status が 502 になる）。

- [ ] **Step 3: route を修正**

`src/app/api/upload/route.ts` の `:26-31` を以下に置き換える:

```typescript
  const res = await ragFetch("/documents", { method: "POST", body: fwd });
  if (res.status === 409) {
    return NextResponse.json(
      { error: "同じ内容のファイルが既にアップロードされています" },
      { status: 409 },
    );
  }
  if (!res.ok) {
    return NextResponse.json({ error: "索引化の開始に失敗しました" }, { status: 502 });
  }
  const data = (await res.json()) as { document_id: string; job_id: string };
  return NextResponse.json({ documentId: data.document_id, jobId: data.job_id });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run src/app/api/upload/upload.test.ts`
Expected: 3 件すべて PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/upload/route.ts src/app/api/upload/upload.test.ts
git commit -m "feat: 重複アップロード時の409を日本語メッセージで返す"
```

---

## Task 5: 稼働中スタックへの反映と最終確認

**Files:** なし（運用手順）

- [ ] **Step 1: 稼働中 docker スタックへマイグレーション適用**

Run: `docker compose exec -T rag uv run alembic upgrade head`
Expected: head（`b7c4d9e1f2a3`）まで適用、またはすでに最新なら no-op。

- [ ] **Step 2: rag 全テスト**

Run: `cd rag && uv run pytest tests/test_documents_api.py -v`
Expected: 全 PASS。

- [ ] **Step 3: Next 関連テスト**

Run: `pnpm vitest run src/app/api/upload/upload.test.ts src/hooks/use-uploads.test.ts`
Expected: 全 PASS（フックは無変更だが回帰がないことを確認）。

---

## Self-Review メモ

- 設計書の全決定事項に対応するタスクがある: エラーで弾く（Task 3/4）、ユーザー単位（Task 3 のフィルタ）、error 除外（部分index の WHERE + クエリ filter）、SHA-256（Task 1-3）、バックエンド強制（Task 3）、バックフィル（Task 2）。
- フロントフックは設計どおり無変更。回帰確認のみ Task 5。
- 型・名称の一貫性: 列名 `content_hash`、index 名 `uq_documents_owner_hash_active`、revision `b7c4d9e1f2a3` を全タスクで統一。
