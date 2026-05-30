# アップロード文書の管理機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アップロード済み全文書の一覧・プレビュー・再索引・ダウンロード・削除ができる管理 UI（サイドバー起動の大型マスター詳細モーダル）を追加する。

**Architecture:** rag サービス（FastAPI）に一覧/削除/プレビューの3エンドポイントを新設し、Next.js は認証して `owner_user_id` を注入する薄いプロキシを置く。UI は `use-documents` フックと `documents-modal` コンポーネントで構成し、サイドバー「データソース」から開く。既存の原本/アセット配信・retry・画像URL絶対化を流用する。

**Tech Stack:** Python/FastAPI/SQLAlchemy/Qdrant（rag）, Next.js App Router/TypeScript/React/Tailwind（web）, pytest / vitest。

設計書: `docs/superpowers/specs/2026-05-31-document-management-design.md`

---

## ファイル構成

**作成（rag）**
- なし（既存ファイルへ追記）

**変更（rag）**
- `rag/app/documents_service.py` — `mineru_dir_for`・`cleanup_document_files`・`encode_cursor`/`decode_cursor`・`list_documents` を追加
- `rag/app/schemas.py` — `DocumentListItem`・`DocumentListResponse` を追加
- `rag/app/routers/documents.py` — `GET /documents`・`DELETE /documents/{id}`・`GET /documents/{id}/preview` を追加、`get_document_raw` に `download` 引数

**作成（web）**
- `src/app/api/documents/route.ts` — 一覧プロキシ（GET）
- `src/app/api/documents/[id]/route.ts` — 削除プロキシ（DELETE）
- `src/app/api/documents/[id]/preview/route.ts` — プレビュープロキシ（GET）
- `src/hooks/use-documents.ts` — 一覧データ層フック
- `src/components/documents/documents-modal.tsx` — 管理モーダル
- 各種 `*.test.ts(x)`

**変更（web）**
- `src/app/api/documents/[id]/raw/route.ts` — `download` クエリ透過
- `src/lib/types.ts` — `DocumentSummary`・`DocumentListResponse`・`DocumentPreview` を追加
- `src/components/sidebar/sidebar.tsx` — 「データソース」起動・実数バッジ
- `src/components/workspace/workspace.tsx` — モーダル state・件数取得・配線

---

## Task 1: rag — ファイルパス導出とクリーンアップ

**Files:**
- Modify: `rag/app/documents_service.py`
- Test: `rag/tests/test_documents_cleanup.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_cleanup.py`:

```python
from pathlib import Path

from app.documents_service import (
    assets_dir_for,
    cleanup_document_files,
    mineru_dir_for,
)


def test_mineru_dir_for_is_sibling_of_assets():
    raw = "/data/uploads/abc_report.pdf"
    assert mineru_dir_for(raw) == "/data/uploads/abc_report_mineru"
    assert assets_dir_for(raw) == "/data/uploads/abc_report_assets"


def test_cleanup_removes_raw_assets_mineru_and_parsed_md(tmp_path):
    raw = tmp_path / "abc_report.pdf"
    raw.write_bytes(b"%PDF")
    assets = Path(assets_dir_for(str(raw)))
    (assets / "images").mkdir(parents=True)
    (assets / "images" / "0.jpg").write_bytes(b"img")
    mineru = Path(mineru_dir_for(str(raw)))
    mineru.mkdir()
    (mineru / "layout.json").write_text("{}")
    parsed_md = tmp_path / "abc_report.md"
    parsed_md.write_text("# md")

    cleanup_document_files(str(raw), str(parsed_md))

    assert not raw.exists()
    assert not assets.exists()
    assert not mineru.exists()
    assert not parsed_md.exists()


def test_cleanup_is_best_effort_on_missing_paths():
    # 存在しないパスでも例外を投げない
    cleanup_document_files("/nonexistent/x.pdf", None)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_cleanup.py -v`
Expected: FAIL（`ImportError: cannot import name 'cleanup_document_files'`）

- [ ] **Step 3: 実装を追加**

`rag/app/documents_service.py` の先頭 import を `import shutil` 追加し、`assets_dir_for` の直後に追記:

```python
def mineru_dir_for(raw_path: str) -> str:
    """原本パスから MinerU 生出力ディレクトリを決定的に導出する（worker の out_dir と一致）。"""
    return str(Path(raw_path).with_suffix("")) + "_mineru"


def cleanup_document_files(raw_path: str, parsed_md_path: str | None = None) -> None:
    """文書に紐づく実体（原本・解析MD・_assets・_mineru）を best-effort で削除する。"""
    for f in (raw_path, parsed_md_path):
        if f:
            Path(f).unlink(missing_ok=True)
    for d in (assets_dir_for(raw_path), mineru_dir_for(raw_path)):
        shutil.rmtree(d, ignore_errors=True)
```

ファイル冒頭が `from pathlib import Path` のみなら、その下に `import shutil` を追加する。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_cleanup.py -v`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add rag/app/documents_service.py rag/tests/test_documents_cleanup.py
git commit -m "feat: 文書削除用のファイルクリーンアップ共通ヘルパを追加"
```

---

## Task 2: rag — カーソルコーデックと一覧サービス

**Files:**
- Modify: `rag/app/documents_service.py`, `rag/app/schemas.py`
- Test: `rag/tests/test_documents_cursor.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_cursor.py`:

```python
from datetime import datetime

from app.documents_service import decode_cursor, encode_cursor


def test_cursor_roundtrip():
    ts = datetime(2026, 5, 31, 12, 34, 56)
    token = encode_cursor(ts, "doc-123")
    got_ts, got_id = decode_cursor(token)
    assert got_ts == ts
    assert got_id == "doc-123"


def test_cursor_is_opaque_urlsafe():
    token = encode_cursor(datetime(2026, 1, 1), "id|with|pipes")
    assert "|" not in token  # base64url 化されており生の区切りが露出しない
    _, got_id = decode_cursor(token)
    assert got_id == "id|with|pipes"
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_cursor.py -v`
Expected: FAIL（`ImportError`）

- [ ] **Step 3: 実装を追加**

`rag/app/documents_service.py` 冒頭 import に追加: `import base64` と `from datetime import datetime`。ファイル末尾に追記:

```python
def encode_cursor(created_at: datetime, doc_id: str) -> str:
    raw = f"{created_at.isoformat()}|{doc_id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    ts, doc_id = raw.split("|", 1)
    return datetime.fromisoformat(ts), doc_id
```

`rag/app/schemas.py` 末尾に追記（冒頭に `from datetime import datetime` を追加）:

```python
class DocumentListItem(BaseModel):
    id: str
    filename: str
    mime: str
    size: int
    page_count: int | None = None
    status: str
    created_at: datetime
    chunk_count: int
    latest_job_id: str | None = None
    error: str | None = None


class DocumentListResponse(BaseModel):
    items: list[DocumentListItem]
    next_cursor: str | None = None
    total: int
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_cursor.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add rag/app/documents_service.py rag/app/schemas.py rag/tests/test_documents_cursor.py
git commit -m "feat: 文書一覧のカーソルコーデックとスキーマを追加"
```

---

## Task 3: rag — `list_documents` サービス本体

**Files:**
- Modify: `rag/app/documents_service.py`
- Test: `rag/tests/test_documents_list_service.py`（新規）

このサービスは N+1 を避けるため、ページ分の chunk 件数と最新ジョブを各 1 クエリで一括取得する。テストはダミーセッションを注入して呼び出しシーケンスとマージ結果を検証する。

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_list_service.py`:

```python
from datetime import datetime
from types import SimpleNamespace

from app.documents_service import list_documents


class _Query:
    """filter/order_by/limit/count/all をチェーン可能にする最小スタブ。"""

    def __init__(self, rows, *, count=None):
        self._rows = rows
        self._count = count if count is not None else len(rows)

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def group_by(self, *a, **k):
        return self

    def count(self):
        return self._count

    def all(self):
        return self._rows


def _doc(i):
    return SimpleNamespace(
        id=f"d{i}", filename=f"f{i}.pdf", mime="application/pdf", size=10,
        page_count=2, status="ready", raw_path=f"/u/d{i}.pdf",
        created_at=datetime(2026, 5, 31, 0, i),
    )


def test_list_documents_returns_items_total_and_next_cursor():
    docs = [_doc(2), _doc(1), _doc(0)]  # created_at desc 前提

    class _Session:
        def __init__(self):
            self.calls = 0

        def query(self, *entities):
            self.calls += 1
            # 1回目: total カウント / 2回目: ページ本体 / 3回目: chunk 集計 / 4回目: jobs
            if self.calls == 1:
                return _Query([], count=3)
            if self.calls == 2:
                return _Query(list(docs))
            if self.calls == 3:
                return _Query([("d2", 5), ("d1", 7)])  # chunk_count
            return _Query([
                SimpleNamespace(id="j2", document_id="d2", error=None,
                                created_at=datetime(2026, 5, 31, 0, 2)),
            ])

    resp = list_documents(_Session(), owner_user_id="u1", limit=2)
    assert resp.total == 3
    assert [it.id for it in resp.items] == ["d2", "d1"]  # limit=2 で打ち切り
    assert resp.items[0].chunk_count == 5
    assert resp.items[0].latest_job_id == "j2"
    assert resp.items[1].chunk_count == 0  # 集計に無ければ 0
    assert resp.next_cursor is not None  # 3 件中 2 件取得 → 続きあり
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_list_service.py -v`
Expected: FAIL（`ImportError: cannot import name 'list_documents'`）

- [ ] **Step 3: 実装を追加**

`rag/app/documents_service.py` に追記（冒頭 import に `from sqlalchemy import func, tuple_` と `from app.models import Chunk, Document, IngestJob` を追加。循環 import を避けるためモデル import は関数内に置いてもよいが、`documents_service` は `models` に依存しないため、import は関数内ローカルにする）:

```python
def list_documents(session, *, owner_user_id: str, limit: int = 30,
                   cursor: str | None = None, q: str | None = None,
                   status: str | None = None):
    """所有者の文書一覧をキーセット・ページングで返す（chunk件数/最新ジョブを一括取得）。"""
    from sqlalchemy import func, tuple_

    from app.models import Chunk, Document, IngestJob
    from app.schemas import DocumentListItem, DocumentListResponse

    base = session.query(Document).filter(Document.owner_user_id == owner_user_id)
    if q:
        base = base.filter(Document.filename.ilike(f"%{q}%"))
    if status:
        base = base.filter(Document.status == status)

    total = base.count()

    page = base.order_by(Document.created_at.desc(), Document.id.desc())
    if cursor:
        ts, cid = decode_cursor(cursor)
        page = page.filter(tuple_(Document.created_at, Document.id) < (ts, cid))
    docs = page.limit(limit + 1).all()
    has_more = len(docs) > limit
    docs = docs[:limit]

    doc_ids = [d.id for d in docs]
    counts = dict(
        session.query(Chunk.document_id, func.count(Chunk.id))
        .filter(Chunk.document_id.in_(doc_ids))
        .group_by(Chunk.document_id)
        .all()
    ) if doc_ids else {}
    latest_job: dict[str, object] = {}
    if doc_ids:
        for j in (session.query(IngestJob)
                  .filter(IngestJob.document_id.in_(doc_ids))
                  .order_by(IngestJob.created_at.desc())
                  .all()):
            latest_job.setdefault(j.document_id, j)

    items = [
        DocumentListItem(
            id=d.id, filename=d.filename, mime=d.mime, size=d.size,
            page_count=d.page_count, status=d.status, created_at=d.created_at,
            chunk_count=counts.get(d.id, 0),
            latest_job_id=getattr(latest_job.get(d.id), "id", None),
            error=getattr(latest_job.get(d.id), "error", None),
        )
        for d in docs
    ]
    next_cursor = (
        encode_cursor(docs[-1].created_at, docs[-1].id) if has_more and docs else None
    )
    return DocumentListResponse(items=items, next_cursor=next_cursor, total=total)
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_list_service.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add rag/app/documents_service.py rag/tests/test_documents_list_service.py
git commit -m "feat: 文書一覧サービス list_documents を追加"
```

---

## Task 4: rag — `GET /documents` エンドポイント

**Files:**
- Modify: `rag/app/routers/documents.py`
- Test: `rag/tests/test_documents_list_api.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_list_api.py`:

```python
from datetime import datetime

from app.config import settings
from app.routers import documents as documents_router
from app.schemas import DocumentListItem, DocumentListResponse


def test_list_requires_token(client):
    res = client.get("/documents?owner_user_id=u1")
    assert res.status_code == 401


def test_list_passes_filters_and_returns_payload(client, monkeypatch):
    seen = {}

    def fake_list(owner_user_id, limit, cursor, q, status):
        seen.update(owner_user_id=owner_user_id, limit=limit, cursor=cursor, q=q, status=status)
        return DocumentListResponse(
            items=[DocumentListItem(
                id="d1", filename="a.pdf", mime="application/pdf", size=10,
                page_count=2, status="ready", created_at=datetime(2026, 5, 31),
                chunk_count=4, latest_job_id="j1", error=None)],
            next_cursor="CUR", total=1)

    monkeypatch.setattr(documents_router, "_list_documents", fake_list)
    res = client.get(
        "/documents?owner_user_id=u1&limit=10&q=設計&status=ready",
        headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["next_cursor"] == "CUR"
    assert body["items"][0]["chunk_count"] == 4
    assert seen == {"owner_user_id": "u1", "limit": 10, "cursor": None, "q": "設計", "status": "ready"}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_list_api.py -v`
Expected: FAIL（404 もしくは `_list_documents` 不在）

- [ ] **Step 3: 実装を追加**

`rag/app/routers/documents.py` の import に追加:

```python
from app.documents_service import (
    assets_dir_for, cleanup_document_files, list_documents, resolve_within, select_chunks,
)
from app.schemas import (
    DocumentListResponse, FetchDocumentRequest, FetchDocumentResponse, FetchedChunk, IngestStarted,
)
```

（既存の import 行を上記に統合。`cleanup_document_files`・`list_documents`・`DocumentListResponse` を追加するのが要点。）

`router = APIRouter()` の下あたりに追加:

```python
def _list_documents(owner_user_id: str, limit: int, cursor: str | None,
                    q: str | None, status: str | None) -> DocumentListResponse:
    session = SessionLocal()
    try:
        return list_documents(session, owner_user_id=owner_user_id, limit=limit,
                              cursor=cursor, q=q, status=status)
    finally:
        session.close()


@router.get("/documents", response_model=DocumentListResponse,
            dependencies=[Depends(require_internal_token)])
def list_documents_endpoint(owner_user_id: str, limit: int = 30,
                            cursor: str | None = None, q: str | None = None,
                            status: str | None = None):
    return _list_documents(owner_user_id, min(max(limit, 1), 100), cursor, q, status)
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_list_api.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_list_api.py
git commit -m "feat: 文書一覧エンドポイント GET /documents を追加"
```

---

## Task 5: rag — `DELETE /documents/{id}` エンドポイント

**Files:**
- Modify: `rag/app/routers/documents.py`
- Test: `rag/tests/test_documents_delete_api.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_delete_api.py`:

```python
from app.config import settings
from app.routers import documents as documents_router


def test_delete_requires_token(client):
    res = client.delete("/documents/d1?owner_user_id=u1")
    assert res.status_code == 401


def _install_fakes(monkeypatch, owner="u1"):
    deleted = {"vectors": None, "chunks": False, "jobs": False, "doc": False, "files": None}

    class _Doc:
        owner_user_id = owner
        raw_path = "/u/d1.pdf"
        parsed_md_path = None

    class _Filter:
        def __init__(self, kind):
            self.kind = kind

        def delete(self):
            deleted[self.kind] = True

    class _Session:
        def get(self, model, _id):
            return _Doc()

        def query(self, model):
            return self

        def filter(self, *a, **k):
            # Chunk か IngestJob かは呼ばれた順で区別せず両方フラグ立て
            return _Filter("chunks") if not deleted["chunks"] else _Filter("jobs")

        def delete(self, obj):
            deleted["doc"] = True

        def commit(self):
            pass

        def close(self):
            pass

    class _Qdrant:
        def delete_by_document(self, doc_id):
            deleted["vectors"] = doc_id

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(documents_router, "QdrantStore", lambda *a, **k: _Qdrant())
    monkeypatch.setattr(documents_router, "cleanup_document_files",
                        lambda raw, md=None: deleted.update(files=(raw, md)))
    return deleted


def test_delete_removes_vectors_chunks_jobs_doc_and_files(client, monkeypatch):
    deleted = _install_fakes(monkeypatch)
    res = client.delete("/documents/d1?owner_user_id=u1",
                        headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 204
    assert deleted["vectors"] == "d1"
    assert deleted["doc"] is True
    assert deleted["files"] == ("/u/d1.pdf", None)


def test_delete_404_when_not_owner(client, monkeypatch):
    _install_fakes(monkeypatch, owner="owner-A")
    res = client.delete("/documents/d1?owner_user_id=intruder-B",
                        headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_delete_api.py -v`
Expected: FAIL（DELETE 未定義で 405/404）

- [ ] **Step 3: 実装を追加**

`rag/app/routers/documents.py` の import に `Response` と `QdrantStore` を追加:

```python
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
...
from app.vectorstore.qdrant import QdrantStore
```

`retry_job` の下に追加:

```python
@router.delete("/documents/{document_id}", status_code=204,
               dependencies=[Depends(require_internal_token)])
def delete_document(document_id: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = doc.raw_path
        parsed_md_path = doc.parsed_md_path
        QdrantStore().delete_by_document(document_id)
        session.query(Chunk).filter(Chunk.document_id == document_id).delete()
        session.query(IngestJob).filter(IngestJob.document_id == document_id).delete()
        session.delete(doc)
        session.commit()
    finally:
        session.close()
    cleanup_document_files(raw_path, parsed_md_path)
    return Response(status_code=204)
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_delete_api.py -v`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_delete_api.py
git commit -m "feat: 文書削除エンドポイント DELETE /documents/{id} を追加"
```

---

## Task 6: rag — プレビュー（全チャンク）と raw ダウンロード

**Files:**
- Modify: `rag/app/routers/documents.py`
- Test: `rag/tests/test_documents_preview_api.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_preview_api.py`:

```python
from app.config import settings
from app.routers import documents as documents_router
from app.schemas import FetchDocumentResponse, FetchedChunk


def test_preview_requires_token(client):
    res = client.get("/documents/d1/preview?owner_user_id=u1")
    assert res.status_code == 401


def test_preview_returns_all_chunks(client, monkeypatch):
    def fake(document_id, owner_user_id):
        return FetchDocumentResponse(
            document_id=document_id, document_title="設計.pdf",
            chunks=[FetchedChunk(chunk_id=f"c{i}", ordinal=i, heading_path="",
                                 page_start=0, page_end=0, block_type="text",
                                 text=f"本文{i}") for i in range(60)])

    monkeypatch.setattr(documents_router, "_preview_document", fake)
    res = client.get("/documents/d1/preview?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    # 引用用の上限(40)を超えて全件返ること
    assert len(res.json()["chunks"]) == 60


def test_preview_404_when_not_owner(client, monkeypatch):
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
    res = client.get("/documents/d1/preview?owner_user_id=intruder-B",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_preview_api.py -v`
Expected: FAIL（404）

- [ ] **Step 3: 実装を追加**

`rag/app/routers/documents.py` の `fetch_document_chunks` の下に追加:

```python
def _preview_document(document_id: str, owner_user_id: str) -> FetchDocumentResponse:
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        rows = (session.query(Chunk)
                .filter(Chunk.document_id == document_id)
                .order_by(Chunk.ordinal).all())
        return FetchDocumentResponse(
            document_id=doc.id, document_title=doc.filename,
            chunks=[FetchedChunk(chunk_id=c.id, ordinal=c.ordinal, heading_path=c.heading_path,
                                 page_start=c.page_start, page_end=c.page_end,
                                 block_type=c.block_type, text=c.text) for c in rows])
    finally:
        session.close()


@router.get("/documents/{document_id}/preview", response_model=FetchDocumentResponse,
            dependencies=[Depends(require_internal_token)])
def preview_document(document_id: str, owner_user_id: str):
    return _preview_document(document_id, owner_user_id)
```

`get_document_raw` のシグネチャと `FileResponse` を変更（`download` 引数追加）:

```python
@router.get("/documents/{document_id}/raw",
            dependencies=[Depends(require_internal_token)])
def get_document_raw(document_id: str, owner_user_id: str, download: bool = False):
```

戻り値の `FileResponse(...)` の `content_disposition_type="inline"` を:

```python
        content_disposition_type="attachment" if download else "inline",
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && .venv/bin/python -m pytest tests/test_documents_preview_api.py tests/test_documents_api.py -v`
Expected: PASS（preview 3 件 + 既存 raw テストも維持）

- [ ] **Step 5: コミット**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_preview_api.py
git commit -m "feat: 文書プレビュー(全チャンク)と原本ダウンロード切替を追加"
```

---

## Task 7: web — 型定義の追加

**Files:**
- Modify: `src/lib/types.ts`

rag プロキシは snake_case JSON をそのまま返す（既存 `/api/uploads/[id]` と同様の方針）。型もそれに合わせる。

- [ ] **Step 1: 実装を追加**

`src/lib/types.ts` の `// ── Uploads ──` ブロックの直後に追記:

```typescript
// ── Documents (管理) ────────────────────────────────────────────────────────
export interface DocumentSummary {
  id: string;
  filename: string;
  mime: string;
  size: number;
  page_count: number | null;
  status: string;
  created_at: string;
  chunk_count: number;
  latest_job_id: string | null;
  error: string | null;
}

export interface DocumentListResponse {
  items: DocumentSummary[];
  next_cursor: string | null;
  total: number;
}

export interface DocumentPreviewChunk {
  chunk_id: string;
  ordinal: number;
  heading_path: string;
  page_start: number;
  page_end: number;
  block_type: string;
  text: string;
}

export interface DocumentPreview {
  document_id: string;
  document_title: string;
  chunks: DocumentPreviewChunk[];
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/lib/types.ts
git commit -m "feat: 文書管理向けの型定義を追加"
```

---

## Task 8: web — 一覧/削除/プレビュー プロキシ

**Files:**
- Create: `src/app/api/documents/route.ts`, `src/app/api/documents/[id]/route.ts`, `src/app/api/documents/[id]/preview/route.ts`
- Modify: `src/app/api/documents/[id]/raw/route.ts`
- Test: `src/app/api/documents/documents.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`src/app/api/documents/documents.test.ts`:

```typescript
import { expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
  ),
}));

import { GET as listGET } from "@/app/api/documents/route";
import { DELETE as docDELETE } from "@/app/api/documents/[id]/route";
import { GET as previewGET } from "@/app/api/documents/[id]/preview/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

test("documents list requires auth", async () => {
  const res = await listGET(new Request("http://x/api/documents"));
  expect(res.status).toBe(401);
});

test("documents delete requires auth", async () => {
  const res = await docDELETE(new Request("http://x/api/documents/d1"), params("d1"));
  expect(res.status).toBe(401);
});

test("documents preview requires auth", async () => {
  const res = await previewGET(new Request("http://x/api/documents/d1/preview"), params("d1"));
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/app/api/documents/documents.test.ts`
Expected: FAIL（モジュール不在）

- [ ] **Step 3: プロキシを実装**

`src/app/api/documents/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const qs = new URLSearchParams({ owner_user_id: claims.sub });
  for (const k of ["q", "status", "limit", "cursor"]) {
    const v = url.searchParams.get(k);
    if (v) qs.set(k, v);
  }
  const res = await ragFetch(`/documents?${qs.toString()}`);
  if (!res.ok) return NextResponse.json({ error: "list failed" }, { status: 502 });
  return NextResponse.json(await res.json());
}
```

`src/app/api/documents/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}?owner_user_id=${encodeURIComponent(claims.sub)}`,
    { method: "DELETE" },
  );
  if (res.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!res.ok) return NextResponse.json({ error: "delete failed" }, { status: 502 });
  return new NextResponse(null, { status: 204 });
}
```

`src/app/api/documents/[id]/preview/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { resolveImageUrls } from "@/lib/agent/image-urls";
import { ragFetch } from "@/lib/rag-client";
import type { DocumentPreview } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}/preview?owner_user_id=${encodeURIComponent(claims.sub)}`,
  );
  if (!res.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = (await res.json()) as DocumentPreview;
  data.chunks = data.chunks.map((c) => ({ ...c, text: resolveImageUrls(c.text, id) }));
  return NextResponse.json(data);
}
```

`src/app/api/documents/[id]/raw/route.ts` の `ragFetch(...)` 呼び出しを `download` 透過に変更:

```typescript
  const { id } = await ctx.params;
  const download = new URL(_req.url).searchParams.get("download") === "1" ? "&download=1" : "";
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}/raw?owner_user_id=${encodeURIComponent(claims.sub)}${download}`,
  );
```

（`_req` を使うため、必要なら関数引数名 `_req` を `req` に変更し参照する。`download` 時は rag が `content-disposition: attachment` を返し、既存の header 転送でそのまま伝播する。）

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/app/api/documents/documents.test.ts`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add src/app/api/documents src/app/api/documents/[id]/raw/route.ts
git commit -m "feat: 文書一覧/削除/プレビューのNext.jsプロキシを追加"
```

---

## Task 9: web — `use-documents` フック

**Files:**
- Create: `src/hooks/use-documents.ts`
- Test: `src/hooks/use-documents.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く（純粋ヘルパ）**

`src/hooks/use-documents.test.ts`:

```typescript
import { expect, test } from "vitest";
import { mergeNextPage } from "@/hooks/use-documents";
import type { DocumentSummary } from "@/lib/types";

const doc = (id: string): DocumentSummary => ({
  id, filename: `${id}.pdf`, mime: "application/pdf", size: 1, page_count: 1,
  status: "ready", created_at: "2026-05-31", chunk_count: 1, latest_job_id: null, error: null,
});

test("mergeNextPage appends and dedupes by id", () => {
  const prev = [doc("a"), doc("b")];
  const merged = mergeNextPage(prev, [doc("b"), doc("c")]);
  expect(merged.map((d) => d.id)).toEqual(["a", "b", "c"]);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/hooks/use-documents.test.ts`
Expected: FAIL（`mergeNextPage` 不在）

- [ ] **Step 3: フックを実装**

`src/hooks/use-documents.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentListResponse, DocumentSummary } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

/** ページ追記時に id 重複を除いてマージする純粋関数。 */
export function mergeNextPage(prev: DocumentSummary[], next: DocumentSummary[]): DocumentSummary[] {
  const seen = new Set(prev.map((d) => d.id));
  return [...prev, ...next.filter((d) => !seen.has(d.id))];
}

const PENDING = new Set(["queued", "processing", "parsing", "chunking", "embedding", "indexing"]);

/** 文書一覧の取得・検索・ページング・削除・再索引・状態ポーリングを担うデータ層。 */
export function useDocuments(open: boolean, onToast?: PushToast) {
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const onToastRef = useRef(onToast);
  useEffect(() => { onToastRef.current = onToast; }, [onToast]);

  const buildQs = useCallback((cursor?: string | null) => {
    const qs = new URLSearchParams({ limit: "30" });
    if (query.trim()) qs.set("q", query.trim());
    if (statusFilter) qs.set("status", statusFilter);
    if (cursor) qs.set("cursor", cursor);
    return qs.toString();
  }, [query, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/documents?${buildQs()}`).catch(() => null);
    setLoading(false);
    if (!r || !r.ok) return;
    const j = (await r.json()) as DocumentListResponse;
    setItems(j.items);
    setTotal(j.total);
    setNextCursor(j.next_cursor);
  }, [buildQs]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const r = await fetch(`/api/documents?${buildQs(nextCursor)}`).catch(() => null);
    if (!r || !r.ok) return;
    const j = (await r.json()) as DocumentListResponse;
    setItems((prev) => mergeNextPage(prev, j.items));
    setTotal(j.total);
    setNextCursor(j.next_cursor);
  }, [buildQs, nextCursor]);

  // モーダルが開いている間、検索/フィルタ変更で先頭から再取得（デバウンス）。
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [open, load]);

  const remove = useCallback(async (id: string) => {
    const prev = items;
    setItems((cur) => cur.filter((d) => d.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    const r = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) {
      setItems(prev);
      setTotal(prev.length);
      onToastRef.current?.("削除に失敗しました", "error");
      return;
    }
    onToastRef.current?.("文書を削除しました", "success");
  }, [items]);

  const retry = useCallback(async (jobId: string, id: string) => {
    setItems((cur) => cur.map((d) => (d.id === id ? { ...d, status: "processing", error: null } : d)));
    const r = await fetch(`/api/uploads/${encodeURIComponent(jobId)}/retry`, { method: "POST" }).catch(() => null);
    if (!r || !r.ok) onToastRef.current?.("再索引に失敗しました", "error");
  }, []);

  // 表示中かつ未完了の文書だけをポーリングして状態を更新する。
  useEffect(() => {
    if (!open) return;
    const pending = items.filter((d) => PENDING.has(d.status) && d.latest_job_id);
    if (!pending.length) return;
    const t = setInterval(async () => {
      for (const d of pending) {
        const r = await fetch(`/api/uploads/${encodeURIComponent(d.latest_job_id!)}`).catch(() => null);
        if (!r || !r.ok) continue;
        const j = (await r.json()) as { status: string; chunks?: number; page_count?: number | null; error?: string };
        setItems((cur) => cur.map((x) => (x.id === d.id ? {
          ...x, status: j.status, chunk_count: j.chunks ?? x.chunk_count,
          page_count: j.page_count ?? x.page_count, error: j.error ?? null,
        } : x)));
      }
    }, 1500);
    return () => clearInterval(t);
  }, [open, items]);

  return {
    items, total, nextCursor, loading, query, statusFilter,
    setQuery, setStatusFilter, load, loadMore, remove, retry,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/hooks/use-documents.test.ts && pnpm exec tsc --noEmit`
Expected: PASS、型エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/hooks/use-documents.ts src/hooks/use-documents.test.ts
git commit -m "feat: 文書一覧データ層フック use-documents を追加"
```

---

## Task 10: web — 管理モーダル UI

**Files:**
- Create: `src/components/documents/documents-modal.tsx`

既存のデザイントークン（`bg-surface`, `border-divider`, `text-fg`, `text-muted`, `bg-accent` 等）と `Icon`・`getFileMeta`・`formatFileSize`・`useConfirm` を流用する。

- [ ] **Step 1: コンポーネントを実装**

`src/components/documents/documents-modal.tsx`:

```typescript
"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { useConfirm } from "@/hooks/use-confirm";
import { useDocuments } from "@/hooks/use-documents";
import { getFileMeta } from "@/lib/file-types";
import { cn, formatFileSize } from "@/lib/utils";
import type { DocumentPreview, DocumentSummary } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

type Tab = "pdf" | "text" | "images";
const IMG_RE = /!\[[^\]]*\]\((\/api\/documents\/[^)\s]+)\)/g;

const STATUS_LABEL: Record<string, string> = {
  ready: "索引済み", error: "エラー", queued: "待機中", processing: "処理中",
  parsing: "解析中", chunking: "チャンク化", embedding: "埋め込み", indexing: "索引化",
};

export function DocumentsModal({ open, onClose, onChanged, onToast }: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  onToast?: PushToast;
}) {
  const docs = useDocuments(open, onToast);
  const { confirm, dialog } = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pdf");
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selected = docs.items.find((d) => d.id === selectedId) ?? null;

  // 選択文書のプレビュー（全チャンク）を取得。
  useEffect(() => {
    if (!selectedId) { setPreview(null); return; }
    setPreviewLoading(true);
    setPreview(null);
    fetch(`/api/documents/${encodeURIComponent(selectedId)}/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPreview(j))
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [selectedId]);

  const images = useMemo(() => {
    if (!preview) return [] as string[];
    const urls = new Set<string>();
    for (const c of preview.chunks) {
      for (const m of c.text.matchAll(IMG_RE)) urls.add(m[1]);
    }
    return [...urls];
  }, [preview]);

  if (!open) return null;

  const onDelete = async (d: DocumentSummary) => {
    const ok = await confirm({
      title: "この文書を削除しますか？",
      description: `「${d.filename}」と抽出データ・索引を完全に削除します。元に戻せません。`,
      confirmLabel: "削除する",
      tone: "danger",
    });
    if (!ok) return;
    if (selectedId === d.id) setSelectedId(null);
    await docs.remove(d.id);
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-[rgba(20,18,15,0.55)] p-4 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className="flex h-[88vh] w-[90vw] max-w-[1180px] flex-col overflow-hidden rounded-[16px] border-[0.5px] border-divider-strong bg-surface shadow-e3 max-md:h-[92vh] max-md:w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-[0.5px] border-divider px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-bold text-fg">
            <Icon name="database" size={15} />
            <span>データソース</span>
            <span className="font-mono text-[11px] font-normal text-muted">{docs.total}件</span>
          </div>
          <button className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-muted hover:bg-divider hover:text-fg" onClick={onClose} aria-label="閉じる">
            <svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: list */}
          <div className="flex w-[320px] shrink-0 flex-col border-r-[0.5px] border-divider max-md:w-[180px]">
            <div className="flex flex-col gap-2 p-2.5">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2"><Icon name="search" size={12} /></span>
                <input
                  value={docs.query}
                  onChange={(e) => docs.setQuery(e.target.value)}
                  placeholder="ファイル名で検索…"
                  className="h-[30px] w-full rounded-lg border-[0.5px] border-divider-strong bg-bg-2 pl-[30px] pr-2.5 text-[12.5px] text-fg outline-none placeholder:text-muted-2 focus:bg-surface"
                />
              </div>
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {docs.items.map((d) => {
                const meta = getFileMeta(d.filename);
                return (
                  <button
                    key={d.id}
                    onClick={() => { setSelectedId(d.id); setTab("pdf"); }}
                    className={cn(
                      "group/dr my-px flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                      selectedId === d.id ? "bg-surface-2 shadow-e1" : "hover:bg-divider",
                    )}
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]" style={{ background: meta.color + "20", color: meta.color }}>
                      <Icon name={meta.iconName} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-fg" title={d.filename}>{d.filename}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted">
                        {formatFileSize(d.size)}{d.page_count ? ` · ${d.page_count}p` : ""} · {d.chunk_count}ch
                      </span>
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold",
                      d.status === "ready" && "bg-accent-soft text-accent",
                      d.status === "error" && "bg-[rgba(184,58,31,0.12)] text-[#B83A1F]",
                      d.status !== "ready" && d.status !== "error" && "bg-divider text-muted",
                    )}>{STATUS_LABEL[d.status] ?? d.status}</span>
                  </button>
                );
              })}
              {docs.nextCursor && (
                <button onClick={docs.loadMore} className="mx-auto my-2 block rounded-lg border-[0.5px] border-divider-strong bg-transparent px-3 py-1.5 text-[12px] font-medium text-fg-2 hover:bg-divider">
                  さらに読み込む
                </button>
              )}
              {!docs.loading && !docs.items.length && (
                <div className="px-3 py-8 text-center text-[12px] text-muted">該当する文書がありません</div>
              )}
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex min-w-0 flex-1 flex-col">
            {!selected ? (
              <div className="grid flex-1 place-items-center text-[12.5px] text-muted">左から文書を選択してください</div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b-[0.5px] border-divider px-3 py-2">
                  <div className="flex gap-1">
                    {([["pdf", "原本PDF"], ["text", "解析テキスト"], ["images", `画像${images.length ? ` (${images.length})` : ""}`]] as [Tab, string][]).map(([t, label]) => (
                      <button key={t} onClick={() => setTab(t)} className={cn(
                        "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        tab === t ? "bg-surface-2 text-fg shadow-e1" : "text-muted hover:text-fg",
                      )}>{label}</button>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {(selected.status === "error" || selected.status === "ready") && selected.latest_job_id && (
                      <button onClick={() => docs.retry(selected.latest_job_id!, selected.id)} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-fg-2 hover:bg-divider" title="再索引">再索引</button>
                    )}
                    <a href={`/api/documents/${encodeURIComponent(selected.id)}/raw?download=1`} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-fg-2 hover:bg-divider">ダウンロード</a>
                    <button onClick={() => onDelete(selected)} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-[#B83A1F] hover:bg-[rgba(184,58,31,0.12)]">削除</button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-bg-2">
                  {tab === "pdf" && (
                    <iframe title={selected.filename} src={`/api/documents/${encodeURIComponent(selected.id)}/raw`} className="h-full w-full border-0" />
                  )}
                  {tab === "text" && (
                    <div className="mx-auto max-w-[760px] p-5">
                      {previewLoading && <div className="text-[12px] text-muted">読み込み中…</div>}
                      {preview?.chunks.map((c) => (
                        <div key={c.chunk_id} className="mb-4">
                          {c.heading_path && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{c.heading_path}</div>}
                          <div className="whitespace-pre-wrap text-[13px] leading-[1.7] text-fg-2">{c.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === "images" && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-5">
                      {previewLoading && <div className="text-[12px] text-muted">読み込み中…</div>}
                      {images.map((src) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={src} src={src} alt="" className="w-full rounded-lg border-[0.5px] border-divider" />
                      ))}
                      {!previewLoading && !images.length && <div className="text-[12px] text-muted">抽出画像はありません</div>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし。`ConfirmModal` の本文プロパティは `description`（`body` ではない）、利用可能なのは `title`/`description`/`confirmLabel`/`cancelLabel`/`tone` のみ。型エラーが出たらこの一覧に合わせる（新規プロパティは足さない）。

- [ ] **Step 3: コミット**

```bash
git add src/components/documents/documents-modal.tsx
git commit -m "feat: 文書管理モーダル(一覧・プレビュー・操作)を追加"
```

---

## Task 11: web — サイドバー起動と workspace 配線

**Files:**
- Modify: `src/components/sidebar/sidebar.tsx`, `src/components/workspace/workspace.tsx`

- [ ] **Step 1: Sidebar に起動 props を追加**

`src/components/sidebar/sidebar.tsx` の `SidebarProps` に追加:

```typescript
  onOpenDataSources: () => void;
  dataSourceCount: number;
```

`Sidebar` 関数の分割代入（`const { ... } = props;`）に `onOpenDataSources, dataSourceCount` を追加。
「コレクション」ブロックの `CollectionItem`（データソース）を、クリック可能・実数表示に変更:

```tsx
          <CollectionItem icon="star" label="スター付き" count={String(pinned.length)} />
          <CollectionItem icon="folder" label="プロジェクト" count="4" />
          <CollectionItem icon="database" label="データソース" count={String(dataSourceCount)} onClick={onOpenDataSources} />
```

`CollectionItem` を `onClick` 対応に変更:

```tsx
function CollectionItem({ icon, label, count, onClick }: { icon: "star" | "folder" | "database"; label: string; count: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="my-px flex w-full items-center gap-2 rounded-md bg-transparent px-2 py-1.5 text-left text-[12.5px] text-fg-2 hover:bg-divider">
      <span className="w-4 text-center"><Icon name={icon} size={13} /></span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[10.5px] text-muted">{count}</span>
    </button>
  );
}
```

- [ ] **Step 2: workspace に state・件数取得・配線を追加**

`src/components/workspace/workspace.tsx` の import に追加:

```typescript
import { DocumentsModal } from "@/components/documents/documents-modal";
```

`const [helpOpen, setHelpOpen] = useState(false);` の近くに追加:

```typescript
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [dataSourceCount, setDataSourceCount] = useState(0);

  const refreshDataSourceCount = useCallback(() => {
    fetch("/api/documents?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setDataSourceCount(j.total); })
      .catch(() => {});
  }, []);
  useEffect(() => { refreshDataSourceCount(); }, [refreshDataSourceCount]);
```

（`useCallback`/`useEffect` は既存 import 済み。トースト push 関数は `const { toasts, push, dismiss } = useToasts();` の `push`（`useUploads(push)` と同じもの）。）

`<Sidebar ... />` に props を追加:

```tsx
        onOpenDataSources={() => setDocumentsOpen(true)}
        dataSourceCount={dataSourceCount}
```

`<HelpModal ... />` の近く（モーダル群）に追加:

```tsx
      <DocumentsModal
        open={documentsOpen}
        onClose={() => { setDocumentsOpen(false); refreshDataSourceCount(); }}
        onChanged={refreshDataSourceCount}
        onToast={push}
      />
```

- [ ] **Step 3: 型チェックとビルド**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 全テスト**

Run: `pnpm exec vitest run && cd rag && .venv/bin/python -m pytest -q`
Expected: すべて PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/sidebar/sidebar.tsx src/components/workspace/workspace.tsx
git commit -m "feat: サイドバーのデータソースから文書管理モーダルを起動"
```

---

## Task 12: 手動検証（rag 再ビルド込み）

**Files:** なし（動作確認のみ）

> **メモ:** rag はソースマウントなしの焼き込みイメージ。rag/ を変更したら反映に再ビルドが必要。

- [ ] **Step 1: rag を再ビルドして起動**

Run: `docker compose up -d --build rag rag-worker`
Expected: 両コンテナが healthy

- [ ] **Step 2: Web を起動して確認**

Run: `pnpm dev`
確認:
- サイドバー「データソース」のバッジが実数で表示される
- クリックでモーダルが開き、文書一覧（検索・フィルタ・さらに読み込む）が動く
- 文書選択で 原本PDF / 解析テキスト / 画像 タブが表示される
- 再索引・ダウンロード・削除（確認ダイアログ→削除後リストから消える）が動く
- 削除後、対応する `_assets`/`_mineru` ディレクトリと原本がボリュームから消えている（`docker compose exec rag ls /data/uploads`）

- [ ] **Step 3: 最終コミット（必要なら微修正）**

```bash
git add -A
git commit -m "test: 文書管理機能の手動検証と微修正"
```

---

## Self-Review メモ

- 仕様カバレッジ: 一覧(ページング/q/status/total)=Task3-4、削除(全実体クリーン)=Task1,5、プレビュー(全チャンク+画像)=Task6,10、ダウンロード=Task6,8、再索引=Task9-10、サイドバー実数バッジ=Task11 — 全て対応。
- 型整合: rag は snake_case を返し、web 型(`DocumentSummary` 等)も snake_case で一致。`latest_job_id` を一覧→retry→ポーリングで一貫使用。
- 既存非互換なし: `fetch_document_chunks`/retry/assets は不変、raw は後方互換な任意 `download` のみ。
- 既存インターフェース確認済み: `ConfirmModal` 本文プロパティ=`description`、トースト=`useToasts()` の `push`、`getFileMeta`（file-types）/`formatFileSize`（utils）/`PushToast`（use-toasts）すべて export 済み。
