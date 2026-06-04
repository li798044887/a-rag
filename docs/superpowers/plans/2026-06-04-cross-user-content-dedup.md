# コンテンツアドレス方式による横断共有 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 異なるユーザーが上げた同一バイトのファイルを `content_hash` 単位で 1 回だけ解析・埋め込み・保存し、各ユーザーは参照（library entry）だけ持つコンテンツアドレス方式に再設計する。

**Architecture:** rag の DB を「共有実体 `contents`（`content_hash` 主キー、原本・チャンク・ベクトル・ジョブの所有者）」と「ユーザーごとの参照 `documents`（`id` 据え置き、`filename` のみユーザー固有）」に分離する。`chunks`/`ingest_jobs` は `content_hash` 紐づけ。検索は Qdrant 点に `content_hash` を付与し、検索時に「そのユーザーが参照する `content_hash` 集合」を `MatchAny` で絞り、結果を各ユーザーの `document_id`/`filename` へ写像し直す。削除は `ref_count` GC、アップロードと GC は `contents` 行の `FOR UPDATE` で直列化する。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2.0（Mapped）/ Alembic / Qdrant / arq(Redis)。テストは pytest（ホストから `cd rag && uv run pytest`、Postgres は 5433・Qdrant は 6333 が稼働している前提）。

**設計スペック:** `docs/superpowers/specs/2026-06-04-cross-user-content-dedup-design.md`

---

## 前提・テスト実行手順（全タスク共通）

- DB 統合テストは Postgres(5433) と Qdrant(6333) の稼働が前提。`docker compose --profile worker up -d` で起動済みであること。
- スキーマ変更後は必ずマイグレーションを適用する:
  ```bash
  docker compose exec -T rag uv run alembic upgrade head
  ```
- テストはホストの `rag/` ディレクトリから実行する（`rag/tests/conftest.py` が `DATABASE_URL` を 5433 に既定設定する）:
  ```bash
  cd rag && uv run pytest tests/<file>::<test> -v
  ```
- コミットメッセージは Conventional Commits（日本語）。末尾に必ず:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- ブランチ `feat/cross-user-content-dedup` 上で作業する（作成済み）。

## ファイル構成（このプランで触る範囲）

- `rag/app/models.py` — `Content` 追加、`Document`/`Chunk`/`IngestJob` 改修（タスク1）
- `rag/alembic/versions/c1d2e3f4a5b6_content_addressed_store.py` — 破壊的再構築（タスク1）
- `rag/app/vectorstore/qdrant.py` — payload/フィルタ/削除を `content_hash` 基準へ＋payload index（タスク2）
- `rag/app/worker.py` — `run_ingest`/`requeue_interrupted_jobs` を content 基準へ（タスク3）
- `rag/app/documents_service.py` — `list_documents`/`workspace_stats` を content JOIN へ（タスク4）
- `rag/app/routers/documents.py` — upload（dedup＋refcount）（タスク5）、delete/bulk-delete/cancel（GC）（タスク6）、配信系/fetch/preview（タスク8）
- `rag/app/retrieval/service.py` — content_hash フィルタ＋document_id 写像（タスク7）
- `rag/app/routers/jobs.py` — `get_job` を content 基準へ（タスク8）
- `rag/tests/*` — content_hash 前提へ改修（各タスク内）
- `CLAUDE.md` — リセット手順を追記（タスク9）

> web 側（`src/`）は `citations` がスナップショット保存で rag への FK が無く、検索結果が従来どおり `document_id` を返すため改修しない。

---

## Task 1: データモデルとマイグレーション（破壊的再構築）

**Files:**
- Modify: `rag/app/models.py`
- Create: `rag/alembic/versions/c1d2e3f4a5b6_content_addressed_store.py`
- Test: `rag/tests/test_content_model.py`

- [ ] **Step 1: `models.py` を新スキーマへ書き換える**

`rag/app/models.py` 全体を以下で置き換える:

```python
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Content(Base):
    """同一バイトのファイル実体。content_hash 単位で 1 個だけ存在し、
    原本・解析成果物・チャンク・ベクトル・ジョブを所有する。ref_count が 0 で GC。"""
    __tablename__ = "contents"
    content_hash: Mapped[str] = mapped_column(String, primary_key=True)
    mime: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_path: Mapped[str] = mapped_column(String)
    parsed_md_path: Mapped[str | None] = mapped_column(String, nullable=True)
    ref_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Document(Base):
    """ユーザーごとの参照（library entry）。id は web/citations の識別子として据え置き。"""
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "content_hash", name="uq_documents_owner_content"),
    )
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, index=True)
    content_hash: Mapped[str] = mapped_column(ForeignKey("contents.content_hash"), index=True)
    filename: Mapped[str] = mapped_column(String)  # ユーザー固有（同一バイトでも名前は別々）
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    content_hash: Mapped[str] = mapped_column(ForeignKey("contents.content_hash"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    heading_path: Mapped[str] = mapped_column(Text, default="")
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    block_type: Mapped[str] = mapped_column(String)
    token_len: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)


class IngestJob(Base):
    __tablename__ = "ingest_jobs"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    content_hash: Mapped[str] = mapped_column(ForeignKey("contents.content_hash"), index=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0–100
    stage_detail: Mapped[str] = mapped_column(String, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class WorkspaceActivity(Base):
    __tablename__ = "workspace_activity"
    owner_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    last_document_activity_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

- [ ] **Step 2: Alembic マイグレーションを作成する**

`rag/alembic/versions/c1d2e3f4a5b6_content_addressed_store.py` を新規作成:

```python
"""content addressed store

Revision ID: c1d2e3f4a5b6
Revises: b7c4d9e1f2a3
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "b7c4d9e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 既存データは破棄してよい（横断共有への再構築）。FK 依存順に drop。
    op.drop_table("chunks")
    op.drop_table("ingest_jobs")
    op.drop_table("documents")

    op.create_table(
        "contents",
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("mime", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("raw_path", sa.String(), nullable=False),
        sa.Column("parsed_md_path", sa.String(), nullable=True),
        sa.Column("ref_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("content_hash"),
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["content_hash"], ["contents.content_hash"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id", "content_hash", name="uq_documents_owner_content"),
    )
    op.create_index(op.f("ix_documents_owner_user_id"), "documents", ["owner_user_id"], unique=False)
    op.create_index(op.f("ix_documents_content_hash"), "documents", ["content_hash"], unique=False)
    op.create_table(
        "chunks",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("heading_path", sa.Text(), nullable=False),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.String(), nullable=False),
        sa.Column("token_len", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["content_hash"], ["contents.content_hash"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chunks_content_hash"), "chunks", ["content_hash"], unique=False)
    op.create_table(
        "ingest_jobs",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("stage_detail", sa.String(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["content_hash"], ["contents.content_hash"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ingest_jobs_content_hash"), "ingest_jobs", ["content_hash"], unique=False)


def downgrade() -> None:
    # 旧スキーマ（空テーブル）へ戻す。データ移行はしない。
    op.drop_index(op.f("ix_ingest_jobs_content_hash"), table_name="ingest_jobs")
    op.drop_table("ingest_jobs")
    op.drop_index(op.f("ix_chunks_content_hash"), table_name="chunks")
    op.drop_table("chunks")
    op.drop_index(op.f("ix_documents_content_hash"), table_name="documents")
    op.drop_index(op.f("ix_documents_owner_user_id"), table_name="documents")
    op.drop_table("documents")
    op.drop_table("contents")

    op.create_table(
        "documents",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("mime", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("raw_path", sa.String(), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=True),
        sa.Column("parsed_md_path", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_documents_owner_user_id"), "documents", ["owner_user_id"], unique=False)
    op.create_table(
        "chunks",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("document_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("heading_path", sa.Text(), nullable=False),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.String(), nullable=False),
        sa.Column("token_len", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chunks_document_id"), "chunks", ["document_id"], unique=False)
    op.create_table(
        "ingest_jobs",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("document_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("stage_detail", sa.String(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ingest_jobs_document_id"), "ingest_jobs", ["document_id"], unique=False)
    op.create_index(op.f("ix_ingest_jobs_owner_user_id"), "ingest_jobs", ["owner_user_id"], unique=False)
```

- [ ] **Step 3: マイグレーションを適用する**

Run:
```bash
docker compose exec -T rag uv run alembic upgrade head
```
Expected: `Running upgrade b7c4d9e1f2a3 -> c1d2e3f4a5b6` が出てエラーなく完了。

- [ ] **Step 4: 失敗するテストを書く**

`rag/tests/test_content_model.py` を新規作成:

```python
import uuid

from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob


def _mk_content(session, content_hash):
    c = Content(content_hash=content_hash, mime="application/pdf", size=10,
                raw_path=f"/tmp/{content_hash}.pdf", status="queued", ref_count=0)
    session.add(c)
    session.flush()
    return c


def test_content_holds_chunks_and_jobs_by_hash():
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    try:
        _mk_content(session, h)
        session.add(Chunk(content_hash=h, ordinal=0, heading_path="", page_start=0,
                          page_end=0, block_type="text", token_len=3, text="本文"))
        session.add(IngestJob(content_hash=h, status="queued"))
        session.commit()
        assert session.query(Chunk).filter_by(content_hash=h).count() == 1
        assert session.query(IngestJob).filter_by(content_hash=h).count() == 1
    finally:
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_same_owner_same_content_unique():
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    owner = "u_" + uuid.uuid4().hex
    try:
        _mk_content(session, h)
        session.add(Document(owner_user_id=owner, content_hash=h, filename="a.pdf"))
        session.commit()
        session.add(Document(owner_user_id=owner, content_hash=h, filename="a-again.pdf"))
        raised = False
        try:
            session.commit()
        except IntegrityError:
            raised = True
            session.rollback()
        assert raised, "同一 owner・同一 content の二重参照は UNIQUE 違反になること"
    finally:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_content_model.py -v
```
Expected: 2 件 PASS。

- [ ] **Step 6: コミット**

```bash
git add rag/app/models.py rag/alembic/versions/c1d2e3f4a5b6_content_addressed_store.py rag/tests/test_content_model.py
git commit -m "$(printf 'feat: 共有実体contentsとユーザー参照documentsへデータモデルを再構築\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: QdrantStore を content_hash 基準へ

**Files:**
- Modify: `rag/app/vectorstore/qdrant.py`
- Test: `rag/tests/test_qdrant_content_filter.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_qdrant_content_filter.py` を新規作成:

```python
import uuid

from app.embedding.base import DenseSparse
from app.vectorstore.qdrant import QdrantStore


def _row(chunk_id, content_hash, text):
    return {
        "chunk_id": chunk_id, "content_hash": content_hash, "heading_path": "",
        "page_start": 0, "page_end": 0, "block_type": "text", "source_type": "doc",
        "text": text,
        "vector": DenseSparse(dense=[0.1] * 8, sparse={1: 0.5}),
    }


def test_dense_search_filters_by_content_hashes():
    coll = "test_cf_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    store.ensure_collection()
    ha, hb = "ha_" + uuid.uuid4().hex, "hb_" + uuid.uuid4().hex
    ca, cb = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        store.upsert([_row(ca, ha, "A の本文"), _row(cb, hb, "B の本文")])
        # ha だけを許可 → ca のみ返る
        hits = store.dense_search([0.1] * 8, [ha], limit=10)
        ids = {h["chunk_id"] for h in hits}
        assert ca in ids and cb not in ids
        # 空集合 → 何も返らない
        assert store.dense_search([0.1] * 8, [], limit=10) == []
    finally:
        store.drop()


def test_delete_by_content_removes_only_that_content():
    coll = "test_cf_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    store.ensure_collection()
    ha, hb = "ha_" + uuid.uuid4().hex, "hb_" + uuid.uuid4().hex
    try:
        store.upsert([_row(str(uuid.uuid4()), ha, "A"), _row(str(uuid.uuid4()), hb, "B")])
        store.delete_by_content(ha)
        assert store.dense_search([0.1] * 8, [ha], limit=10) == []
        assert len(store.dense_search([0.1] * 8, [hb], limit=10)) == 1
    finally:
        store.drop()
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run:
```bash
cd rag && uv run pytest tests/test_qdrant_content_filter.py -v
```
Expected: FAIL（`delete_by_content` 未定義 / `dense_search` の引数不一致）。

- [ ] **Step 3: `qdrant.py` を実装する**

`rag/app/vectorstore/qdrant.py` の `upsert` 以降を以下に置き換える（`ensure_collection` に payload index 追加、payload を content_hash 基準へ、フィルタを content_hashes へ、`delete_by_document`→`delete_by_content`）:

```python
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def ensure_collection(self) -> None:
        if self.client.collection_exists(self.collection):
            return
        self.client.create_collection(
            self.collection,
            vectors_config={DENSE: models.VectorParams(size=self.dim, distance=models.Distance.COSINE)},
            sparse_vectors_config={SPARSE: models.SparseVectorParams()},
        )
        # content_hash の MatchAny を効率化する payload index。
        self.client.create_payload_index(
            self.collection, field_name="content_hash",
            field_schema=models.PayloadSchemaType.KEYWORD)

    def upsert(self, rows: list[dict]) -> None:
        points = []
        for r in rows:
            vec: DenseSparse = r["vector"]
            payload = {k: r[k] for k in (
                "chunk_id", "content_hash", "heading_path",
                "page_start", "page_end", "block_type", "source_type", "text",
            )}
            points.append(models.PointStruct(
                id=r["chunk_id"],
                vector={
                    DENSE: vec.dense,
                    SPARSE: models.SparseVector(
                        indices=list(vec.sparse.keys()),
                        values=list(vec.sparse.values()),
                    ),
                },
                payload=payload,
            ))
        self.client.upsert(self.collection, points=points)

    def count(self) -> int:
        return self.client.count(self.collection).count

    def _scope_filter(self, content_hashes: list[str]) -> models.Filter:
        return models.Filter(must=[models.FieldCondition(
            key="content_hash", match=models.MatchAny(any=list(content_hashes)))])

    @staticmethod
    def _payloads(res) -> list[dict]:
        out = []
        for p in res.points:
            payload = dict(p.payload or {})
            payload["score"] = p.score
            out.append(payload)
        return out

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def dense_search(self, query_dense: list[float], content_hashes: list[str],
                     limit: int = 40) -> list[dict]:
        if not content_hashes or not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection, query=query_dense, using=DENSE, limit=limit,
            query_filter=self._scope_filter(content_hashes), with_payload=True)
        return self._payloads(res)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def sparse_search(self, query_sparse: dict[int, float], content_hashes: list[str],
                      limit: int = 40) -> list[dict]:
        if not content_hashes or not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection,
            query=models.SparseVector(indices=list(query_sparse.keys()), values=list(query_sparse.values())),
            using=SPARSE, limit=limit,
            query_filter=self._scope_filter(content_hashes), with_payload=True)
        return self._payloads(res)

    def delete_by_content(self, content_hash: str) -> None:
        if not self.client.collection_exists(self.collection):
            return
        self.client.delete(self.collection, points_selector=models.FilterSelector(
            filter=models.Filter(must=[models.FieldCondition(
                key="content_hash", match=models.MatchValue(value=content_hash))])))

    def drop(self) -> None:
        self.client.delete_collection(self.collection)
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_qdrant_content_filter.py -v
```
Expected: 2 件 PASS。

- [ ] **Step 5: コミット**

```bash
git add rag/app/vectorstore/qdrant.py rag/tests/test_qdrant_content_filter.py
git commit -m "$(printf 'feat: Qdrantをcontent_hash基準のpayload/フィルタ/削除へ変更\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: ワーカーを content_hash 基準へ

**Files:**
- Modify: `rag/app/worker.py`
- Test: `rag/tests/test_worker_pipeline.py`（全面改修）

- [ ] **Step 1: `worker.py` を実装する**

`rag/app/worker.py` の `_set` から `requeue_interrupted_jobs` までを以下に置き換える（import 行の `Document` は `Content` 併記、`run_ingest` の引数を `content_hash` に、`ingest_document`/`requeue_interrupted_jobs` を content 基準に）:

冒頭の import を次に変更:
```python
from app.models import Chunk, Content, Document, IngestJob
```

`_set` 以降を置き換え:
```python
def _set(job: IngestJob, content: Content, session: Session, *,
         status: str, progress: int, detail: str = "") -> None:
    job.status = status
    job.progress = progress
    job.stage_detail = detail
    content.status = status if status in ("ready", "error") else "processing"
    if status == "ready":
        # この content を参照する全 owner の活動時刻を更新する。
        owners = (session.query(Document.owner_user_id)
                  .filter(Document.content_hash == content.content_hash)
                  .distinct().all())
        for (owner,) in owners:
            record_workspace_activity(session, owner_user_id=owner)
    session.commit()


def _copy_assets(parsed: ParsedDocument, raw_path: str) -> None:
    """MinerU が出力した images/ を、実体ごとの安定ディレクトリへ複製する。
    再実行時は作り直す（冪等）。画像が無ければ何もしない。"""
    if not parsed.images_dir:
        return
    src = Path(parsed.images_dir) / "images"
    if not src.is_dir():
        return
    dst = Path(assets_dir_for(raw_path)) / "images"
    if dst.exists():
        shutil.rmtree(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def run_ingest(session: Session, store: QdrantStore, embedder: Embedder,
               parse_fn: ParseFn, content_hash: str, job_id: str) -> None:
    content = session.get(Content, content_hash)
    job = session.get(IngestJob, job_id)
    if not content or not job:
        # キャンセル等で行が消えた後に Worker が拾った場合。エラーにせず no-op で終える。
        return
    try:
        store.ensure_collection()

        # 冪等化: 再実行/再アップロード時に旧チャンク(PG)と旧ベクトル(Qdrant)を掃除。
        session.query(Chunk).filter_by(content_hash=content.content_hash).delete()
        session.commit()
        store.delete_by_content(content.content_hash)

        _set(job, content, session, status="parsing", progress=10, detail="解析中")
        out_dir = str(Path(content.raw_path).with_suffix("")) + "_mineru"
        parsed = parse_fn(content.raw_path, out_dir)
        content.page_count = parsed.page_count
        _copy_assets(parsed, content.raw_path)

        _set(job, content, session, status="chunking", progress=40, detail="チャンク化")
        chunks = chunk_blocks(parsed.blocks)
        rows = []
        for ch in chunks:
            row = Chunk(content_hash=content.content_hash, ordinal=ch.ordinal,
                        heading_path=ch.heading_path, page_start=ch.page_start,
                        page_end=ch.page_end, block_type=ch.block_type,
                        token_len=ch.token_len, text=ch.text)
            session.add(row)
            rows.append((row, ch))
        session.flush()

        # 画像チャンクは表示専用: PG には残すが埋め込み・Qdrant 索引からは除外する。
        index_rows = [(row, ch) for row, ch in rows if ch.block_type != "image"]

        _set(job, content, session, status="embedding", progress=70, detail="埋め込み生成")
        texts = [f"{ch.heading_path}\n\n{ch.text}".strip() for _, ch in index_rows]
        vectors = embedder.embed(texts) if texts else []

        _set(job, content, session, status="indexing", progress=90, detail="索引化")
        store.upsert([
            {
                "chunk_id": row.id, "content_hash": content.content_hash,
                "heading_path": ch.heading_path, "page_start": ch.page_start,
                "page_end": ch.page_end, "block_type": ch.block_type,
                "source_type": "doc", "text": ch.text, "vector": vectors[i],
            }
            for i, (row, ch) in enumerate(index_rows)
        ])

        _set(job, content, session, status="ready", progress=100, detail="完了")
    except Exception as exc:  # noqa: BLE001
        job.status = "error"
        job.error = str(exc)
        content.status = "error"
        content.error = str(exc)
        session.commit()
        raise


async def ingest_document(ctx: dict, content_hash: str, job_id: str) -> None:
    session = SessionLocal()
    try:
        try:
            embedder = get_embedder()
            store = QdrantStore(dim=embedder.dim)
        except Exception as exc:  # noqa: BLE001
            job = session.get(IngestJob, job_id)
            content = session.get(Content, content_hash)
            if job:
                job.status = "error"
                job.error = str(exc)
            if content:
                content.status = "error"
                content.error = str(exc)
            session.commit()
            raise
        await asyncio.to_thread(
            run_ingest, session, store, embedder, parse_document, content_hash, job_id
        )
    finally:
        session.close()


async def requeue_interrupted_jobs(ctx: dict) -> None:
    """Worker 再起動時、DB と Redis キューのズレを修復する。"""
    redis = ctx["redis"]
    session = SessionLocal()
    try:
        jobs = (
            session.query(IngestJob)
            .filter(IngestJob.status.in_(("queued", "parsing", "chunking", "embedding", "indexing")))
            .all()
        )
        for job in jobs:
            job.status = "queued"
            job.progress = 0
            job.stage_detail = ""
            job.error = None
            content = session.get(Content, job.content_hash)
            if content:
                content.status = "queued"
            await redis.enqueue_job(
                "ingest_document",
                job.content_hash,
                job.id,
                _job_id=job.id,
            )
        session.commit()
    finally:
        session.close()
```

> `_copy_assets` は内容変更なしだが、ファイル全体の連続性のため上記に含めている。既存定義が残る場合は重複させず置換すること。

- [ ] **Step 2: `test_worker_pipeline.py` を content 基準へ書き換える**

`rag/tests/test_worker_pipeline.py` を以下で全置換:

```python
import uuid
from pathlib import Path

import pytest

from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob, WorkspaceActivity
from app.parsing.types import ParsedBlock, ParsedDocument
from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore
from app.worker import ingest_document, run_ingest

COLL = "test_ingest_" + uuid.uuid4().hex[:8]


def fake_parse(path, out_dir):
    return ParsedDocument(
        blocks=[ParsedBlock(type="title", text="章", level=1),
                ParsedBlock(type="text", text="本文です。", page=0)],
        page_count=1,
    )


class RecordingEmbedder(StubEmbedder):
    def __init__(self, dim: int = 8):
        super().__init__(dim=dim)
        self.seen: list[str] = []

    def embed(self, texts):
        self.seen = list(texts)
        return super().embed(texts)


def _mk(session, owner, content_hash, raw_path):
    content = Content(content_hash=content_hash, mime="application/pdf", size=10,
                      raw_path=raw_path, status="queued", ref_count=1)
    session.add(content)
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename="x.pdf")
    job = IngestJob(content_hash=content_hash, status="queued")
    session.add(doc)
    session.add(job)
    session.commit()
    return content, doc, job


def _cleanup(session, store, content_hash, owner=None):
    store.drop()
    session.query(Chunk).filter_by(content_hash=content_hash).delete()
    session.query(IngestJob).filter_by(content_hash=content_hash).delete()
    session.query(Document).filter_by(content_hash=content_hash).delete()
    session.query(Content).filter_by(content_hash=content_hash).delete()
    if owner:
        session.query(WorkspaceActivity).filter_by(owner_user_id=owner).delete()
    session.commit()
    session.close()


def test_run_ingest_persists_chunks_and_marks_ready():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    content, doc, job = _mk(session, owner, h, "/tmp/x.pdf")

    store = QdrantStore(collection=COLL, dim=8)
    run_ingest(session, store, StubEmbedder(dim=8), fake_parse, h, job.id)

    session.refresh(content)
    session.refresh(job)
    assert content.status == "ready"
    assert job.status == "ready" and job.progress == 100
    n_chunks = session.query(Chunk).filter_by(content_hash=h).count()
    assert n_chunks >= 1
    assert store.count() == n_chunks
    activity = session.get(WorkspaceActivity, owner)
    assert activity is not None and activity.last_document_activity_at is not None

    _cleanup(session, store, h, owner)


def test_run_ingest_marks_all_owners_activity():
    """共有 content の ready 化は、参照する全 owner の活動を記録する。"""
    session = SessionLocal()
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    content, _, job = _mk(session, o1, h, "/tmp/x.pdf")
    session.add(Document(owner_user_id=o2, content_hash=h, filename="x2.pdf"))
    content.ref_count = 2
    session.commit()

    store = QdrantStore(collection="test_two_" + uuid.uuid4().hex[:8], dim=8)
    run_ingest(session, store, StubEmbedder(dim=8), fake_parse, h, job.id)

    assert session.get(WorkspaceActivity, o1) is not None
    assert session.get(WorkspaceActivity, o2) is not None

    store.drop()
    session.query(Chunk).filter_by(content_hash=h).delete()
    session.query(IngestJob).filter_by(content_hash=h).delete()
    session.query(Document).filter_by(content_hash=h).delete()
    session.query(Content).filter_by(content_hash=h).delete()
    session.query(WorkspaceActivity).filter(WorkspaceActivity.owner_user_id.in_([o1, o2])).delete()
    session.commit()
    session.close()


def test_run_ingest_copies_assets_and_excludes_image_chunks(tmp_path):
    mineru_dir = tmp_path / "mineru"
    (mineru_dir / "images").mkdir(parents=True)
    (mineru_dir / "images" / "a.png").write_bytes(b"\x89PNG\r\n")
    raw = tmp_path / "doc.pdf"
    raw.write_bytes(b"%PDF-1.7")

    def parse_with_image(path, out_dir):
        return ParsedDocument(
            blocks=[ParsedBlock(type="title", text="章", level=1),
                    ParsedBlock(type="text", text="本文です。", page=0),
                    ParsedBlock(type="image", image_path="images/a.png",
                                caption="図", page=0)],
            page_count=1, images_dir=str(mineru_dir),
        )

    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    content, _, job = _mk(session, "u1", h, str(raw))

    emb = RecordingEmbedder(dim=8)
    coll = "test_ingest_img_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    run_ingest(session, store, emb, parse_with_image, h, job.id)

    chunks = session.query(Chunk).filter_by(content_hash=h).all()
    types = {c.block_type for c in chunks}
    assert "image" in types
    n_index = sum(1 for c in chunks if c.block_type != "image")
    assert store.count() == n_index
    assert all("![" not in t for t in emb.seen)
    copied = Path(str(raw.with_suffix("")) + "_assets") / "images" / "a.png"
    assert copied.is_file()

    _cleanup(session, store, h)


async def test_ingest_document_marks_error_when_model_setup_fails(monkeypatch):
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    content, _, job = _mk(session, "u1", h, "/tmp/x.pdf")
    job_id = job.id
    session.close()

    def boom():
        raise RuntimeError("model download failed")

    monkeypatch.setattr("app.worker.get_embedder", boom)

    with pytest.raises(RuntimeError):
        await ingest_document({}, h, job_id)

    check = SessionLocal()
    try:
        j = check.get(IngestJob, job_id)
        c = check.get(Content, h)
        assert j.status == "error"
        assert "model download failed" in (j.error or "")
        assert c.status == "error"
    finally:
        check.query(IngestJob).filter_by(content_hash=h).delete()
        check.query(Document).filter_by(content_hash=h).delete()
        check.query(Content).filter_by(content_hash=h).delete()
        check.commit()
        check.close()
```

- [ ] **Step 3: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_worker_pipeline.py -v
```
Expected: 4 件 PASS。

- [ ] **Step 4: コミット**

```bash
git add rag/app/worker.py rag/tests/test_worker_pipeline.py
git commit -m "$(printf 'feat: ワーカーをcontent_hash基準の解析・索引化へ変更\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: 一覧・統計を content JOIN へ

**Files:**
- Modify: `rag/app/documents_service.py`（`list_documents` と `workspace_stats`）
- Test: `rag/tests/test_documents_list_service.py`（改修）, `rag/tests/test_workspace_stats_service.py`（改修）

> `cleanup_document_files` / `assets_dir_for` / `mineru_dir_for` / `rendered_pdf_for` / `select_chunks` / `record_workspace_activity` / cursor 系は raw_path・引数ベースで content 化の影響を受けないため変更しない。

- [ ] **Step 1: `list_documents` を置き換える**

`rag/app/documents_service.py` の `list_documents` 関数全体を以下に置換:

```python
def list_documents(session, *, owner_user_id: str, limit: int = 30,
                   cursor: str | None = None, q: str | None = None,
                   status: str | None = None):
    """所有者の参照(library entry)一覧をキーセット・ページングで返す。
    mime/size/page_count/status は共有 content から JOIN し、chunk件数/最新ジョブは
    content_hash 単位で一括取得する。"""
    from sqlalchemy import func, tuple_

    from app.models import Chunk, Content, Document, IngestJob
    from app.schemas import DocumentListItem, DocumentListResponse

    def _base():
        q_ = (session.query(Document, Content)
              .join(Content, Document.content_hash == Content.content_hash)
              .filter(Document.owner_user_id == owner_user_id))
        if q:
            q_ = q_.filter(Document.filename.ilike(f"%{q}%"))
        if status:
            q_ = q_.filter(Content.status == status)
        return q_

    total = _base().count()

    page = _base().order_by(Document.created_at.desc(), Document.id.desc())
    if cursor:
        try:
            ts, cid = decode_cursor(cursor)
        except Exception as exc:  # noqa: BLE001 — 不正/破損カーソルは 400 にする
            raise ValueError("invalid cursor") from exc
        page = page.filter(tuple_(Document.created_at, Document.id) < (ts, cid))
    rows = page.limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    hashes = [c.content_hash for _, c in rows]
    counts = dict(
        session.query(Chunk.content_hash, func.count(Chunk.id))
        .filter(Chunk.content_hash.in_(hashes))
        .group_by(Chunk.content_hash)
        .all()
    ) if hashes else {}
    latest_job: dict[str, object] = {}
    if hashes:
        for j in (session.query(IngestJob)
                  .filter(IngestJob.content_hash.in_(hashes))
                  .order_by(IngestJob.created_at.desc())
                  .all()):
            latest_job.setdefault(j.content_hash, j)

    items = [
        DocumentListItem(
            id=d.id, filename=d.filename, mime=c.mime, size=c.size,
            page_count=c.page_count, status=c.status, created_at=d.created_at,
            chunk_count=counts.get(c.content_hash, 0),
            latest_job_id=getattr(latest_job.get(c.content_hash), "id", None),
            error=getattr(latest_job.get(c.content_hash), "error", None),
        )
        for d, c in rows
    ]
    next_cursor = (
        encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None
    )
    return DocumentListResponse(items=items, next_cursor=next_cursor, total=total)
```

- [ ] **Step 2: `workspace_stats` を置き換える**

`rag/app/documents_service.py` の `workspace_stats` 関数全体を以下に置換:

```python
def workspace_stats(session, *, owner_user_id: str):
    """所有者のワークスペース統計を返す。indexed は content.status=ready の参照数。"""
    from app.models import Content, Document, WorkspaceActivity
    from app.schemas import WorkspaceStats

    total = session.query(Document).filter(Document.owner_user_id == owner_user_id).count()
    indexed = (
        session.query(Document)
        .join(Content, Document.content_hash == Content.content_hash)
        .filter(Document.owner_user_id == owner_user_id, Content.status == "ready")
        .count()
    )
    activity = (
        session.query(WorkspaceActivity)
        .filter(WorkspaceActivity.owner_user_id == owner_user_id)
        .limit(1)
        .all()
    )
    last_synced_at = activity[0].last_document_activity_at if activity else None
    return WorkspaceStats(
        indexed_document_count=indexed,
        total_document_count=total,
        connected_data_source_count=1 if total > 0 else 0,
        last_synced_at=last_synced_at,
    )
```

- [ ] **Step 3: 一覧サービステストを書き換える**

`rag/tests/test_documents_list_service.py` を以下で全置換:

```python
import uuid

from app.db import SessionLocal
from app.documents_service import list_documents
from app.models import Chunk, Content, Document, IngestJob


def _seed(session, owner, n):
    hashes = []
    for i in range(n):
        h = f"h_{uuid.uuid4().hex}"
        session.add(Content(content_hash=h, mime="application/pdf", size=10,
                            raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
        session.flush()
        session.add(Document(owner_user_id=owner, content_hash=h, filename=f"f{i}.pdf"))
        session.add(Chunk(content_hash=h, ordinal=0, heading_path="", page_start=0,
                          page_end=0, block_type="text", token_len=1, text="t"))
        session.add(IngestJob(content_hash=h, status="ready"))
        hashes.append(h)
    session.commit()
    return hashes


def _cleanup(session, hashes, owner):
    session.query(Chunk).filter(Chunk.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.query(IngestJob).filter(IngestJob.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.query(Document).filter(Document.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.query(Content).filter(Content.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.commit()
    session.close()


def test_list_returns_content_fields_and_counts():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    hashes = _seed(session, owner, 2)
    try:
        res = list_documents(session, owner_user_id=owner, limit=30)
        assert res.total == 2
        assert len(res.items) == 2
        for it in res.items:
            assert it.mime == "application/pdf"
            assert it.status == "ready"
            assert it.chunk_count == 1
            assert it.latest_job_id is not None
    finally:
        _cleanup(session, hashes, owner)


def test_list_pagination_cursor():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    hashes = _seed(session, owner, 3)
    try:
        first = list_documents(session, owner_user_id=owner, limit=2)
        assert len(first.items) == 2 and first.next_cursor
        second = list_documents(session, owner_user_id=owner, limit=2, cursor=first.next_cursor)
        assert len(second.items) == 1 and second.next_cursor is None
    finally:
        _cleanup(session, hashes, owner)
```

- [ ] **Step 4: 統計サービステストを書き換える**

`rag/tests/test_workspace_stats_service.py` を以下で全置換:

```python
import uuid

from app.db import SessionLocal
from app.documents_service import workspace_stats
from app.models import Content, Document


def test_stats_counts_indexed_by_content_status():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h_ready, h_queued = "h_" + uuid.uuid4().hex, "h_" + uuid.uuid4().hex
    try:
        for h, st in ((h_ready, "ready"), (h_queued, "queued")):
            session.add(Content(content_hash=h, mime="application/pdf", size=10,
                                raw_path=f"/tmp/{h}.pdf", status=st, ref_count=1))
            session.flush()
            session.add(Document(owner_user_id=owner, content_hash=h, filename="f.pdf"))
        session.commit()

        stats = workspace_stats(session, owner_user_id=owner)
        assert stats.total_document_count == 2
        assert stats.indexed_document_count == 1
        assert stats.connected_data_source_count == 1
    finally:
        for h in (h_ready, h_queued):
            session.query(Document).filter_by(content_hash=h).delete()
            session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_documents_list_service.py tests/test_workspace_stats_service.py -v
```
Expected: 全 PASS。

- [ ] **Step 6: コミット**

```bash
git add rag/app/documents_service.py rag/tests/test_documents_list_service.py rag/tests/test_workspace_stats_service.py
git commit -m "$(printf 'feat: 一覧と統計を共有contentのJOINで集計する\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: アップロードの横断 dedup と参照カウント

**Files:**
- Modify: `rag/app/routers/documents.py`（`create_document`, `enqueue_ingest`, `_mark_enqueue_failed`, import）
- Test: `rag/tests/test_documents_api.py`（dedup 系を改修・追加）

- [ ] **Step 1: import と enqueue ヘルパを content 基準へ**

`rag/app/routers/documents.py` の import を更新（`Content` 追加）:
```python
from app.models import Chunk, Content, Document, IngestJob
```

`enqueue_ingest` と `_mark_enqueue_failed` を以下に置換:
```python
async def enqueue_ingest(content_hash: str, job_id: str) -> None:
    pool = await create_pool(redis_settings())
    try:
        await pool.enqueue_job("ingest_document", content_hash, job_id, _job_id=job_id)
    finally:
        await pool.aclose()


def _mark_enqueue_failed(content_hash: str, job_id: str, reason: str) -> None:
    """enqueue 失敗時、新規セッションで job/content を error にする。"""
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        content = session.get(Content, content_hash)
        if job:
            job.status = "error"
            job.error = reason
        if content:
            content.status = "error"
            content.error = reason
        session.commit()
    finally:
        session.close()
```

- [ ] **Step 2: `create_document` を dedup＋refcount へ置換**

`rag/app/routers/documents.py` の `create_document` 全体を以下に置換:

```python
@router.post("/documents", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def create_document(file: UploadFile = File(...), owner_user_id: str = Form(...)):
    upload_dir = _upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = file.filename or "file"
    data = await file.read()
    content_hash = hashlib.sha256(data).hexdigest()
    ext = Path(filename).suffix
    mime = file.content_type or "application/octet-stream"

    enqueue_job_id: str | None = None  # 新規解析が必要な時だけセット
    try:
        session = SessionLocal()
        try:
            # contents 行をロックして dedup（削除GCとの直列化）。
            content = (session.query(Content)
                       .filter(Content.content_hash == content_hash)
                       .with_for_update()
                       .one_or_none())

            if content is None:
                # 新規実体: 原本を hash 命名で 1 個だけ保存し、解析ジョブを作る。
                raw_path = upload_dir / f"{content_hash}{ext}"
                raw_path.write_bytes(data)
                content = Content(content_hash=content_hash, mime=mime, size=len(data),
                                  raw_path=str(raw_path), status="queued", ref_count=0)
                session.add(content)
                try:
                    session.flush()
                except IntegrityError:
                    # 別リクエストが同時に同一実体を作成。原本を捨て既存を参照する。
                    session.rollback()
                    raw_path.unlink(missing_ok=True)
                    content = (session.query(Content)
                               .filter(Content.content_hash == content_hash)
                               .with_for_update().one())
                else:
                    job = IngestJob(content_hash=content_hash, status="queued")
                    session.add(job)
                    session.flush()
                    enqueue_job_id = job.id
            elif content.status == "error":
                # 既存実体が解析失敗のまま: 再解析ジョブを作って queued に戻す。
                content.status = "queued"
                content.error = None
                job = IngestJob(content_hash=content_hash, status="queued")
                session.add(job)
                session.flush()
                enqueue_job_id = job.id

            # 同一ユーザーの二重参照は 409。
            existing_doc = (session.query(Document)
                            .filter(Document.owner_user_id == owner_user_id,
                                    Document.content_hash == content_hash)
                            .one_or_none())
            if existing_doc:
                raise HTTPException(status_code=409, detail="duplicate document")

            doc = Document(owner_user_id=owner_user_id, content_hash=content_hash,
                           filename=filename)
            session.add(doc)
            content.ref_count = content.ref_count + 1

            if enqueue_job_id is not None:
                job_id = enqueue_job_id
            else:
                latest = (session.query(IngestJob)
                          .filter(IngestJob.content_hash == content_hash)
                          .order_by(IngestJob.created_at.desc()).first())
                job_id = latest.id if latest else None

            session.flush()
            session.commit()
            result = IngestStarted(document_id=doc.id, job_id=job_id or "")
        finally:
            session.close()
    except HTTPException:
        raise
    except IntegrityError:
        # 同時二重アップロードの競合: UNIQUE 違反を 409 に正規化。
        raise HTTPException(status_code=409, detail="duplicate document")

    if enqueue_job_id is not None:
        try:
            await enqueue_ingest(content_hash, result.job_id)
        except Exception as exc:  # noqa: BLE001
            _mark_enqueue_failed(content_hash, result.job_id, f"enqueue failed: {exc}")
            raise HTTPException(status_code=502, detail="ingest enqueue failed") from exc

    return result
```

> 注: 409（同一ユーザー二重参照）は必ず「既存 content」のケースなので、このパスでは新しい原本ファイルを書いていない。よって 409 時の孤児ファイルは発生しない（`test_duplicate_does_not_leave_orphan_file` が担保）。

- [ ] **Step 3: dedup テストを書き換え・追加する**

`rag/tests/test_documents_api.py` の `_upload` 以降（149 行目以降の dedup テスト群）を以下に置換し、`test_upload_creates_doc_and_enqueues` の enqueue 検証を content_hash 基準へ直す。

まず `test_upload_creates_doc_and_enqueues` 内の検証行を:
```python
    assert enqueued["args"][0] == body["document_id"]
```
から次に変更:
```python
    # enqueue は content_hash を第1引数に取る（document_id ではない）
    assert isinstance(enqueued["args"][0], str) and enqueued["args"][1] == body["job_id"]
```

次に `_upload` 以降の dedup テスト群を以下で置換:
```python
def _upload(client, owner, content, monkeypatch):
    calls = []

    async def fake_enqueue(content_hash, job_id):
        calls.append((content_hash, job_id))

    monkeypatch.setattr("app.routers.documents.enqueue_ingest", fake_enqueue)
    res = client.post(
        "/documents",
        headers={"x-internal-token": settings.rag_internal_token},
        files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")},
        data={"owner_user_id": owner},
    )
    res._enqueue_calls = calls  # type: ignore[attr-defined]
    return res


def test_duplicate_same_owner_rejected(client, monkeypatch):
    owner = f"dup-{uuid.uuid4().hex}"
    content = uuid.uuid4().bytes
    first = _upload(client, owner, content, monkeypatch)
    assert first.status_code == 200
    second = _upload(client, owner, content, monkeypatch)
    assert second.status_code == 409


def test_duplicate_different_owner_shares_content(client, monkeypatch):
    """別ユーザーの同一バイトは 200 だが、解析は 1 回だけ enqueue され、
    2 人目は参照のみ（ref_count=2、content・chunks は共有）になる。"""
    from app.db import SessionLocal
    from app.models import Content, Document

    content = uuid.uuid4().bytes
    a = _upload(client, f"a-{uuid.uuid4().hex}", content, monkeypatch)
    b = _upload(client, f"b-{uuid.uuid4().hex}", content, monkeypatch)
    assert a.status_code == 200 and b.status_code == 200
    # 同じ job_id（共有ジョブ）を指す
    assert a.json()["job_id"] == b.json()["job_id"]
    # 1 人目だけが解析を enqueue している
    assert len(a._enqueue_calls) == 1
    assert len(b._enqueue_calls) == 0

    import hashlib
    h = hashlib.sha256(content).hexdigest()
    session = SessionLocal()
    try:
        c = session.get(Content, h)
        assert c is not None and c.ref_count == 2
        assert session.query(Document).filter_by(content_hash=h).count() == 2
    finally:
        session.close()


def test_duplicate_does_not_leave_orphan_file(client, monkeypatch):
    owner = f"dup-{uuid.uuid4().hex}"
    content = uuid.uuid4().bytes
    _upload(client, owner, content, monkeypatch)
    before = set(os.listdir(settings.upload_dir))
    second = _upload(client, owner, content, monkeypatch)
    assert second.status_code == 409
    after = set(os.listdir(settings.upload_dir))
    assert after == before  # 409 時に新しい生ファイルを残さない


def test_shared_content_stored_once_on_disk(client, monkeypatch):
    """別ユーザー 2 人が同一バイトを上げても、原本はディスク上に 1 個だけ。"""
    content = uuid.uuid4().bytes
    _upload(client, f"a-{uuid.uuid4().hex}", content, monkeypatch)
    after_first = set(os.listdir(settings.upload_dir))
    _upload(client, f"b-{uuid.uuid4().hex}", content, monkeypatch)
    after_second = set(os.listdir(settings.upload_dir))
    assert after_first == after_second  # 2 人目で新規ファイルは増えない
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_documents_api.py -v
```
Expected: 全 PASS（dedup 共有・原本 1 個・孤児なしを含む）。

- [ ] **Step 5: コミット**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_api.py
git commit -m "$(printf 'feat: アップロードを横断dedupと参照カウント方式へ変更\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: 削除・一括削除・キャンセルを参照カウント GC へ

**Files:**
- Modify: `rag/app/routers/documents.py`（`_delete_one`, `delete_document`, `bulk_delete_documents`, `cancel_job`, `retry_job`）
- Test: `rag/tests/test_documents_delete_api.py`（改修）, `rag/tests/test_documents_cancel_api.py`（改修）, `rag/tests/test_documents_bulk_delete_api.py`（改修）

- [ ] **Step 1: `_delete_one` を GC 化する**

`rag/app/routers/documents.py` の `_delete_one` を以下に置換（参照を 1 つ落とし、ref_count が 0 になった時だけ実体・ベクトル・ファイルを掃除。掃除対象パスを返す）:

```python
def _delete_one(session: Session, doc: Document) -> tuple[str | None, str | None]:
    """library entry を 1 つ削除して ref_count を減らす。0 になった時のみ
    Qdrant ベクトル・chunks・ingest_jobs・contents を削除し、cleanup 対象の
    生ファイルパスを返す。0 にならなければ (None, None)。commit と
    cleanup_document_files は呼び出し側で行う。"""
    content_hash = doc.content_hash
    session.delete(doc)
    session.flush()
    content = (session.query(Content)
               .filter(Content.content_hash == content_hash)
               .with_for_update().one_or_none())
    if content is None:
        return (None, None)
    content.ref_count = max(0, content.ref_count - 1)
    if content.ref_count > 0:
        return (None, None)
    raw_path, parsed_md_path = content.raw_path, content.parsed_md_path
    QdrantStore().delete_by_content(content_hash)
    session.query(Chunk).filter(Chunk.content_hash == content_hash).delete()
    session.query(IngestJob).filter(IngestJob.content_hash == content_hash).delete()
    session.delete(content)
    return (raw_path, parsed_md_path)
```

`delete_document` と `bulk_delete_documents` は `_delete_one` を呼ぶ構造のまま動くが、所有チェックは `doc.owner_user_id` で従来どおり。変更不要（`_delete_one` 内部のみ差し替え）。

- [ ] **Step 2: `cancel_job` を content 基準の GC へ置換**

`rag/app/routers/documents.py` の `cancel_job` 全体を以下に置換:

```python
@router.post("/jobs/{job_id}/cancel", status_code=204,
             dependencies=[Depends(require_internal_token)])
def cancel_job(job_id: str, owner_user_id: str | None = None):
    """待機中(queued)実体への参照取り消し。owner の参照を 1 つ落とし、
    ref_count が 0 になった時だけ queued ジョブ・実体・生ファイルを削除する。
    content が queued 以外なら 409。Worker 着手との競合は status 条件付き DELETE で原子化。"""
    session = SessionLocal()
    raw_path: str | None = None
    parsed_md_path: str | None = None
    try:
        job = session.get(IngestJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        content_hash = job.content_hash

        doc = None
        if owner_user_id is not None:
            doc = (session.query(Document)
                   .filter_by(owner_user_id=owner_user_id, content_hash=content_hash)
                   .one_or_none())
            if doc is None:
                raise HTTPException(status_code=404, detail="job not found")

        content = (session.query(Content)
                   .filter_by(content_hash=content_hash)
                   .with_for_update().one_or_none())
        if content is None or content.status != "queued":
            cur = content.status if content else "gone"
            raise HTTPException(status_code=409, detail=f"job is {cur}, cannot cancel")

        # 参照を落とす。owner 指定なし（管理操作）は全参照を落として完全 GC。
        if doc is not None:
            session.delete(doc)
            content.ref_count = max(0, content.ref_count - 1)
        else:
            session.query(Document).filter_by(content_hash=content_hash).delete()
            content.ref_count = 0
        session.flush()

        if content.ref_count == 0:
            # status='queued' の行だけを原子的に削除。0件なら Worker 着手済みなので 409。
            deleted = (session.query(IngestJob)
                       .filter(IngestJob.id == job_id, IngestJob.status == "queued")
                       .delete())
            if not deleted:
                session.rollback()
                raise HTTPException(status_code=409,
                                    detail="job is no longer queued, cannot cancel")
            raw_path, parsed_md_path = content.raw_path, content.parsed_md_path
            QdrantStore().delete_by_content(content_hash)
            session.query(Chunk).filter_by(content_hash=content_hash).delete()
            session.query(IngestJob).filter_by(content_hash=content_hash).delete()
            session.delete(content)
        session.commit()
    finally:
        session.close()
    cleanup_document_files(raw_path, parsed_md_path)
    return Response(status_code=204)
```

- [ ] **Step 3: `retry_job` を content 基準へ置換**

`rag/app/routers/documents.py` の `retry_job` 全体を以下に置換（job→content を解決、owner 指定時は library entry 所有を検証、content を queued に戻して再 enqueue）:

```python
@router.post("/jobs/{job_id}/retry", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def retry_job(job_id: str, owner_user_id: str | None = None):
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        content_hash = job.content_hash
        # owner 指定時は library entry 所有を強制（IDOR 防止）。
        doc = None
        if owner_user_id is not None:
            doc = (session.query(Document)
                   .filter_by(owner_user_id=owner_user_id, content_hash=content_hash)
                   .one_or_none())
            if doc is None:
                raise HTTPException(status_code=404, detail="job not found")
        if job.status not in ("ready", "error"):
            raise HTTPException(status_code=409, detail=f"job is {job.status}, cannot retry")
        job.status = "queued"; job.progress = 0; job.error = None; job.stage_detail = ""
        content = session.get(Content, content_hash)
        if content:
            content.status = "queued"
            content.error = None
        # 結果に返す document_id は要求 owner の参照（無ければ任意の参照）。
        if doc is None:
            doc = session.query(Document).filter_by(content_hash=content_hash).first()
        session.commit()
        result = IngestStarted(document_id=doc.id if doc else content_hash, job_id=job.id)
    finally:
        session.close()
    await enqueue_ingest(content_hash, result.job_id)
    return result
```

- [ ] **Step 4: 削除テストを書き換える**

`rag/tests/test_documents_delete_api.py` を以下で全置換:

```python
import uuid

from app.config import settings
from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob


def _seed(owner, content_hash, ref_count, filename="f.pdf"):
    session = SessionLocal()
    c = session.get(Content, content_hash)
    if c is None:
        c = Content(content_hash=content_hash, mime="application/pdf", size=10,
                    raw_path=f"/tmp/{content_hash}.pdf", status="ready", ref_count=ref_count)
        session.add(c)
        session.flush()
        session.add(Chunk(content_hash=content_hash, ordinal=0, heading_path="",
                          page_start=0, page_end=0, block_type="text", token_len=1, text="t"))
        session.add(IngestJob(content_hash=content_hash, status="ready"))
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename=filename)
    session.add(doc)
    session.commit()
    doc_id = doc.id
    session.close()
    return doc_id


def _hdr():
    return {"x-internal-token": settings.rag_internal_token}


def test_delete_last_reference_gcs_content(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    doc_id = _seed(owner, h, ref_count=1)
    res = client.request("DELETE", f"/documents/{doc_id}?owner_user_id={owner}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        assert session.get(Content, h) is None  # 最後の参照削除で実体も消える
        assert session.query(Chunk).filter_by(content_hash=h).count() == 0
    finally:
        session.close()


def test_delete_one_of_two_keeps_content(client):
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    d1 = _seed(o1, h, ref_count=2)
    _seed(o2, h, ref_count=2)  # content は既存なので doc だけ追加
    res = client.request("DELETE", f"/documents/{d1}?owner_user_id={o1}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        c = session.get(Content, h)
        assert c is not None and c.ref_count == 1  # 他ユーザーが参照中なので残る
        assert session.query(Chunk).filter_by(content_hash=h).count() == 1
    finally:
        # 後始末
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_delete_404_when_not_owner(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    doc_id = _seed(owner, h, ref_count=1)
    res = client.request("DELETE", f"/documents/{doc_id}?owner_user_id=intruder", headers=_hdr())
    assert res.status_code == 404
    session = SessionLocal()
    try:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
    finally:
        session.close()
```

- [ ] **Step 5: キャンセルテストを書き換える**

`rag/tests/test_documents_cancel_api.py` を以下で全置換:

```python
import uuid

from app.config import settings
from app.db import SessionLocal
from app.models import Content, Document, IngestJob


def _seed_queued(owner, content_hash):
    session = SessionLocal()
    c = session.get(Content, content_hash)
    if c is None:
        c = Content(content_hash=content_hash, mime="application/pdf", size=10,
                    raw_path=f"/tmp/{content_hash}.pdf", status="queued", ref_count=0)
        session.add(c)
        session.flush()
        session.add(IngestJob(content_hash=content_hash, status="queued"))
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename="f.pdf")
    session.add(doc)
    c.ref_count = c.ref_count + 1
    session.commit()
    job = session.query(IngestJob).filter_by(content_hash=content_hash).first()
    ids = (doc.id, job.id)
    session.close()
    return ids


def _hdr():
    return {"x-internal-token": settings.rag_internal_token}


def test_cancel_last_reference_removes_job_and_content(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    _doc_id, job_id = _seed_queued(owner, h)
    res = client.post(f"/jobs/{job_id}/cancel?owner_user_id={owner}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        assert session.get(Content, h) is None
        assert session.get(IngestJob, job_id) is None
    finally:
        session.close()


def test_cancel_one_of_two_keeps_queued_content(client):
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    _seed_queued(o1, h)
    _doc2, job_id = _seed_queued(o2, h)
    # o1 がキャンセル → ref は減るが content は queued のまま残る
    res = client.post(f"/jobs/{job_id}/cancel?owner_user_id={o1}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        c = session.get(Content, h)
        assert c is not None and c.ref_count == 1
        assert session.get(IngestJob, job_id) is not None
    finally:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_cancel_409_when_not_queued(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    _doc_id, job_id = _seed_queued(owner, h)
    session = SessionLocal()
    c = session.get(Content, h)
    c.status = "parsing"
    session.commit()
    session.close()
    res = client.post(f"/jobs/{job_id}/cancel?owner_user_id={owner}", headers=_hdr())
    assert res.status_code == 409
    session = SessionLocal()
    try:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
    finally:
        session.close()
```

- [ ] **Step 6: 一括削除テストを確認・修正する**

`rag/tests/test_documents_bulk_delete_api.py` を開き、`Document`/`Chunk` を直接生成している箇所を Task6 の `_seed` 同様に `Content`＋`Document`（`ref_count` 設定）へ寄せる。各ドキュメントが**別 content_hash**を持つ独立ケースなら、`_delete_one` は各々 ref_count 1→0 で GC する。テスト本体の API 呼び出し（`POST /documents/bulk-delete`）とレスポンス検証（`deleted`/`not_found`）はそのまま使える。具体の seed は次の形:

```python
def _seed(owner, filename="f.pdf"):
    import uuid
    from app.db import SessionLocal
    from app.models import Content, Document
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    session.add(Content(content_hash=h, mime="application/pdf", size=10,
                        raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=h, filename=filename)
    session.add(doc)
    session.commit()
    doc_id = doc.id
    session.close()
    return doc_id
```

既存テストの doc 生成を上記 `_seed(owner)` 呼び出しに置き換える（owner 不一致を試す `not_found` ケースの doc も同様に作る）。

- [ ] **Step 7: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_documents_delete_api.py tests/test_documents_cancel_api.py tests/test_documents_bulk_delete_api.py -v
```
Expected: 全 PASS。

- [ ] **Step 8: コミット**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_delete_api.py rag/tests/test_documents_cancel_api.py rag/tests/test_documents_bulk_delete_api.py
git commit -m "$(printf 'feat: 削除・キャンセル・再試行を参照カウントGCへ変更\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: 検索を content_hash フィルタ＋document_id 写像へ

**Files:**
- Modify: `rag/app/retrieval/service.py`
- Test: `rag/tests/test_retrieval_service.py`（改修）

> `rag/app/routers/retrieve.py` は変更しない（`retrieve`/`retrieve_stream` のシグネチャは `owner_user_id`/`document_ids` のまま維持し、内部で content_hash に解決する）。

- [ ] **Step 1: `service.py` を実装する**

`rag/app/retrieval/service.py` の `_expand`・`_hit_rows`・`retrieve_stream`・`retrieve` を以下に置換（スコープ解決ヘルパ追加、`document_id` 参照を content_hash＋hash_to_doc 写像に変更）。`_merge_round_robin`・`_ms`・`_timed`・`_expanded_rows` は変更不要。

import は `Chunk, Document` のまま（`Content` は service では使わない。既に `from app.models import Chunk, Document` ならそのまま）:
```python
from app.models import Chunk, Document
```

`_expand` を置換:
```python
def _expand(session: Session, content_hash: str, ordinal: int) -> str:
    rows = (session.query(Chunk)
            .filter(Chunk.content_hash == content_hash,
                    Chunk.ordinal.in_([ordinal - 1, ordinal, ordinal + 1]))
            .order_by(Chunk.ordinal).all())
    return "\n\n".join(r.text for r in rows) if rows else ""
```

`_hit_rows` を置換（title を hash_to_doc から引く）:
```python
def _hit_rows(hits: list[dict], hash_to_doc: dict[str, tuple[str, str]]) -> list[dict]:
    rows = []
    for h in hits:
        ch = h["content_hash"]
        title = hash_to_doc.get(ch, (ch, ch))[1]
        rows.append({"title": title,
                     "heading": h.get("heading_path", ""),
                     "score": float(h.get("score", 0.0))})
    return rows
```

スコープ解決ヘルパを追加（`_hit_rows` の直後あたり）:
```python
def _resolve_scope(session: Session, owner_user_id: str,
                   document_ids: list[str] | None) -> tuple[list[str], dict[str, tuple[str, str]]]:
    """owner（と任意の document_ids 範囲指定）から、検索対象 content_hash 集合と
    content_hash -> (document_id, filename) の写像を作る。
    UNIQUE(owner, content_hash) により owner 内で content_hash は一意。"""
    q = (session.query(Document.content_hash, Document.id, Document.filename)
         .filter(Document.owner_user_id == owner_user_id))
    if document_ids:
        q = q.filter(Document.id.in_(document_ids))
    rows = q.all()
    hash_to_doc = {ch: (did, fn) for ch, did, fn in rows}
    return list(hash_to_doc.keys()), hash_to_doc
```

`retrieve_stream` を置換:
```python
def retrieve_stream(session: Session, store: QdrantStore, embedder: Embedder, reranker: Reranker,
                    *, query: str, owner_user_id: str, top_k: int = 6,
                    candidate_k: int = DEFAULT_CANDIDATE_K,
                    document_ids: list[str] | None = None) -> Iterator[dict]:
    content_hashes, hash_to_doc = _resolve_scope(session, owner_user_id, document_ids)
    reranker_name = getattr(reranker, "name", "?")
    _log_info("retrieve_stream start top_k=%s candidate_k=%s embedder=%s reranker=%s scope=%s",
              top_k, candidate_k, getattr(embedder, "name", "?"), reranker_name, len(content_hashes))

    # 1) embed（1回の呼び出しで dense+sparse の両方を得る）
    _log_info("retrieve_stream stage=embed status=start")
    yield {"stage": "embed", "status": "start"}
    t = time.perf_counter()
    qv = embedder.embed([query])[0]
    embed_ms = _ms(t)
    _log_info("retrieve_stream stage=embed status=done ms=%s dims=%s", embed_ms, len(qv.dense))
    yield {"stage": "embed", "status": "done", "ms": embed_ms,
           "model": getattr(embedder, "name", "?"), "dims": len(qv.dense)}

    # 2) dense / sparse 検索を並行実行。両 start を先に出す。
    _log_info("retrieve_stream stage=vector_search status=start limit=%s", candidate_k)
    yield {"stage": "vector_search", "status": "start"}
    _log_info("retrieve_stream stage=bm25_search status=start limit=%s", candidate_k)
    yield {"stage": "bm25_search", "status": "start"}
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_dense = ex.submit(_timed, store.dense_search, qv.dense, content_hashes, candidate_k)
        f_sparse = ex.submit(_timed, store.sparse_search, qv.sparse, content_hashes, candidate_k)
        dense_hits, dense_ms = f_dense.result()
        _log_info("retrieve_stream stage=vector_search status=done ms=%s count=%s",
                  dense_ms, len(dense_hits))
        yield {"stage": "vector_search", "status": "done", "ms": dense_ms,
               "count": len(dense_hits), "hits": _hit_rows(dense_hits, hash_to_doc)}
        sparse_hits, sparse_ms = f_sparse.result()
        _log_info("retrieve_stream stage=bm25_search status=done ms=%s count=%s",
                  sparse_ms, len(sparse_hits))
        yield {"stage": "bm25_search", "status": "done", "ms": sparse_ms,
               "count": len(sparse_hits), "hits": _hit_rows(sparse_hits, hash_to_doc)}

    if not dense_hits and not sparse_hits:
        _log_info("retrieve_stream stage=rerank status=start candidate_count=0 model=%s",
                  reranker_name)
        yield {"stage": "rerank", "status": "start"}
        _log_info("retrieve_stream stage=rerank status=done ms=0 count=0")
        yield {"stage": "rerank", "status": "done", "ms": 0, "count": 0,
               "model": reranker_name, "top_n": top_k, "selected": []}
        _log_info("retrieve_stream stage=expand status=start")
        yield {"stage": "expand", "status": "start"}
        _log_info("retrieve_stream stage=expand status=done ms=0 count=0")
        yield {"stage": "expand", "status": "done", "ms": 0, "count": 0}
        _log_info("retrieve_stream stage=result count=0")
        yield {"stage": "result", "chunks": []}
        return

    # 3) round-robin マージ + candidate_k 打ち切り
    merged = _merge_round_robin(dense_hits, sparse_hits, candidate_k)

    # 4) rerank
    _log_info("retrieve_stream stage=rerank status=start candidate_count=%s model=%s top_k=%s",
              len(merged), reranker_name, top_k)
    yield {"stage": "rerank", "status": "start"}
    tr = time.perf_counter()
    scores = reranker.score(query, [h["text"] for h in merged])
    ranked = sorted(zip(merged, scores), key=lambda x: x[1], reverse=True)[:top_k]
    selected = [{"id": h["chunk_id"], "score": float(s),
                 "title": hash_to_doc.get(h["content_hash"], (h["content_hash"], h["content_hash"]))[1]}
                for h, s in ranked]
    rerank_ms = _ms(tr)
    _log_info("retrieve_stream stage=rerank status=done ms=%s count=%s", rerank_ms, len(ranked))
    yield {"stage": "rerank", "status": "done", "ms": rerank_ms, "count": len(ranked),
           "model": reranker_name, "top_n": top_k, "selected": selected}

    # 5) expand + RetrievedChunk 構築
    _log_info("retrieve_stream stage=expand status=start")
    yield {"stage": "expand", "status": "start"}
    te = time.perf_counter()
    out: list[RetrievedChunk] = []
    for hit, score in ranked:
        ch = hit["content_hash"]
        document_id, title = hash_to_doc.get(ch, (ch, ch))
        chunk = session.get(Chunk, hit["chunk_id"])
        expanded = "" if chunk is None else _expand(session, ch, chunk.ordinal)
        out.append(RetrievedChunk(
            chunk_id=hit["chunk_id"], document_id=document_id,
            document_title=title, heading_path=hit.get("heading_path", ""),
            page_start=hit.get("page_start", 0), page_end=hit.get("page_end", 0),
            block_type=hit.get("block_type", "text"), text=hit["text"],
            expanded_text=expanded, score=float(score)))
    expand_ms = _ms(te)
    _log_info("retrieve_stream stage=expand status=done ms=%s count=%s", expand_ms, len(out))
    yield {"stage": "expand", "status": "done", "ms": expand_ms, "count": len(out),
           "expanded": _expanded_rows(out)}
    _log_info("retrieve_stream stage=result count=%s", len(out))
    yield {"stage": "result", "chunks": out}
```

`retrieve`（drain ラッパ）はシグネチャ・本体とも変更不要（`retrieve_stream` をそのまま呼ぶ）。

- [ ] **Step 2: 検索サービステストを書き換える**

`rag/tests/test_retrieval_service.py` を以下で全置換:

```python
import uuid

from app.db import SessionLocal
from app.embedding.factory import StubEmbedder
from app.models import Chunk, Content, Document
from app.reranker.base import Reranker
from app.retrieval.service import retrieve
from app.vectorstore.qdrant import QdrantStore


class IdentityReranker(Reranker):
    name = "identity"

    def score(self, query, passages):
        return [1.0 for _ in passages]


def _seed_indexed(session, store, owner, content_hash, filename, text):
    session.add(Content(content_hash=content_hash, mime="application/pdf", size=10,
                        raw_path=f"/tmp/{content_hash}.pdf", status="ready", ref_count=1))
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename=filename)
    session.add(doc)
    chunk = Chunk(content_hash=content_hash, ordinal=0, heading_path="見出し",
                  page_start=1, page_end=1, block_type="text", token_len=3, text=text)
    session.add(chunk)
    session.commit()
    emb = StubEmbedder(dim=8)
    vec = emb.embed([text])[0]
    store.upsert([{
        "chunk_id": chunk.id, "content_hash": content_hash, "heading_path": "見出し",
        "page_start": 1, "page_end": 1, "block_type": "text", "source_type": "doc",
        "text": text, "vector": vec,
    }])
    return doc.id


def test_retrieve_returns_owner_document_id_for_shared_content():
    """共有 content をヒットさせても、結果の document_id は問い合わせ owner の参照になる。"""
    session = SessionLocal()
    store = QdrantStore(collection="test_ret_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    text = "決算は黒字でした。"
    try:
        d1 = _seed_indexed(session, store, o1, h, "o1.pdf", text)
        # o2 も同じ content を参照（ベクトルは共有、再 upsert しない）
        session.add(Document(owner_user_id=o2, content_hash=h, filename="o2.pdf"))
        c = session.get(Content, h); c.ref_count = 2
        session.commit()

        emb = StubEmbedder(dim=8)
        r1 = retrieve(session, store, emb, IdentityReranker(),
                      query=text, owner_user_id=o1, top_k=3, candidate_k=5)
        assert r1 and r1[0].document_id == d1
        assert r1[0].document_title == "o1.pdf"

        # o2 から引くと o2 の document_id / filename になる
        d2 = (session.query(Document)
              .filter_by(owner_user_id=o2, content_hash=h).one()).id
        r2 = retrieve(session, store, emb, IdentityReranker(),
                      query=text, owner_user_id=o2, top_k=3, candidate_k=5)
        assert r2 and r2[0].document_id == d2
        assert r2[0].document_title == "o2.pdf"
    finally:
        store.drop()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_retrieve_excludes_non_referencing_user():
    """参照を持たない owner には共有 content がヒットしない。"""
    session = SessionLocal()
    store = QdrantStore(collection="test_ret_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    owner, intruder = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    text = "社外秘の数値。"
    try:
        _seed_indexed(session, store, owner, h, "o.pdf", text)
        emb = StubEmbedder(dim=8)
        r = retrieve(session, store, emb, IdentityReranker(),
                     query=text, owner_user_id=intruder, top_k=3, candidate_k=5)
        assert r == []
    finally:
        store.drop()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
```

> `StubEmbedder` の dense が全行同一になる実装でも、本テストは「フィルタによる可視/不可視」と「document_id 写像」を検証する目的のため、スコア順位には依存しない。`IdentityReranker` で順位を固定している。

- [ ] **Step 3: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_retrieval_service.py -v
```
Expected: 2 件 PASS。

- [ ] **Step 4: コミット**

```bash
git add rag/app/retrieval/service.py rag/tests/test_retrieval_service.py
git commit -m "$(printf 'feat: 検索をcontent_hashフィルタとdocument_id写像へ変更\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: 配信エンドポイントと get_job / fetch / preview を content 基準へ

**Files:**
- Modify: `rag/app/routers/documents.py`（`_fetch_document`, `_preview_document`, `get_document_raw`, `get_document_rendered`, `get_document_layout`, `get_document_span`, `get_document_asset`）
- Modify: `rag/app/routers/jobs.py`（`get_job`）
- Test: `rag/tests/test_documents_api.py`（raw 系の Doc スタブに content を足す）, `rag/tests/test_fetch_document_api.py`（改修）, `rag/tests/test_documents_preview_api.py`（改修）

- [ ] **Step 1: 配信・取得系を content 解決へ置換**

`rag/app/routers/documents.py` の `_fetch_document`・`_preview_document`・各 `get_document_*` を以下に置換（共通: `doc` を取得し owner 検証 → `content` を取得してパス/属性を使う。fetch/preview は `content_hash` でチャンク取得、タイトルは `doc.filename`）:

```python
def _fetch_document(document_id: str, req: FetchDocumentRequest) -> FetchDocumentResponse:
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != req.owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        rows = (session.query(Chunk)
                .filter(Chunk.content_hash == doc.content_hash)
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
```

```python
def _preview_document(document_id: str, owner_user_id: str) -> FetchDocumentResponse:
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        rows = (session.query(Chunk)
                .filter(Chunk.content_hash == doc.content_hash)
                .order_by(Chunk.ordinal).all())
        return FetchDocumentResponse(
            document_id=doc.id, document_title=doc.filename,
            chunks=[FetchedChunk(chunk_id=c.id, ordinal=c.ordinal, heading_path=c.heading_path,
                                 page_start=c.page_start, page_end=c.page_end,
                                 block_type=c.block_type, text=c.text) for c in rows])
    finally:
        session.close()
```

`get_document_raw` を置換（content から raw_path/mime、表示名は doc.filename）:
```python
@router.api_route("/documents/{document_id}/raw", methods=["GET", "HEAD"],
                  dependencies=[Depends(require_internal_token)])
def get_document_raw(document_id: str, owner_user_id: str, download: bool = False):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        content = session.get(Content, doc.content_hash)
        if not content:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = Path(content.raw_path)
        mime = content.mime
        filename = doc.filename
    finally:
        session.close()
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(
        str(raw_path),
        media_type=mime or "application/octet-stream",
        filename=filename,
        content_disposition_type="attachment" if download else "inline",
    )
```

`get_document_rendered` を置換:
```python
@router.get("/documents/{document_id}/rendered",
            dependencies=[Depends(require_internal_token)])
def get_document_rendered(document_id: str, owner_user_id: str):
    """Office 系原本を LibreOffice で PDF 化（遅延・キャッシュ）して inline 返却する。"""
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        content = session.get(Content, doc.content_hash)
        raw_path = Path(content.raw_path) if content else None
    finally:
        session.close()
    if raw_path is None:
        raise HTTPException(status_code=404, detail="document not found")
    if not is_convertible(str(raw_path)):
        raise HTTPException(status_code=404, detail="not convertible")
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    try:
        pdf = convert_to_pdf(str(raw_path))
    except Exception as exc:  # 変換失敗（破損・タイムアウト・未対応）
        raise HTTPException(status_code=422, detail="conversion failed") from exc
    return FileResponse(str(pdf), media_type="application/pdf",
                        content_disposition_type="inline")
```

`get_document_layout`・`get_document_span`・`get_document_asset` を置換（いずれも content.raw_path から導出）:
```python
@router.get("/documents/{document_id}/layout",
            dependencies=[Depends(require_internal_token)])
def get_document_layout(document_id: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        content = session.get(Content, doc.content_hash)
        raw_path = content.raw_path if content else None
    finally:
        session.close()
    layout = find_layout_pdf(raw_path) if raw_path else None
    if layout is None or not layout.is_file():
        raise HTTPException(status_code=404, detail="layout not found")
    return FileResponse(str(layout), media_type="application/pdf",
                        content_disposition_type="inline")


@router.get("/documents/{document_id}/span",
            dependencies=[Depends(require_internal_token)])
def get_document_span(document_id: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        content = session.get(Content, doc.content_hash)
        raw_path = content.raw_path if content else None
    finally:
        session.close()
    span = find_span_pdf(raw_path) if raw_path else None
    if span is None or not span.is_file():
        raise HTTPException(status_code=404, detail="span not found")
    return FileResponse(str(span), media_type="application/pdf",
                        content_disposition_type="inline")


@router.get("/documents/{document_id}/assets/{asset_path:path}",
            dependencies=[Depends(require_internal_token)])
def get_document_asset(document_id: str, asset_path: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        content = session.get(Content, doc.content_hash)
        raw_path = content.raw_path if content else None
    finally:
        session.close()
    if raw_path is None:
        raise HTTPException(status_code=404, detail="asset not found")
    target = resolve_within(assets_dir_for(raw_path), asset_path)
    if target is None or not target.is_file():
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(str(target))
```

- [ ] **Step 2: `jobs.py` の `get_job` を置換**

`rag/app/routers/jobs.py` 全体を以下に置換:
```python
from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob
from app.schemas import JobStatus
from app.security import require_internal_token

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatus,
            dependencies=[Depends(require_internal_token)])
def get_job(job_id: str, owner_user_id: str | None = None):
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        content_hash = job.content_hash
        # owner 指定時は library entry 所有を強制（IDOR 防止）。
        if owner_user_id is not None:
            doc = (session.query(Document)
                   .filter_by(owner_user_id=owner_user_id, content_hash=content_hash)
                   .one_or_none())
            if doc is None:
                raise HTTPException(status_code=404, detail="job not found")
        else:
            doc = session.query(Document).filter_by(content_hash=content_hash).first()
        content = session.get(Content, content_hash)
        chunks = session.query(Chunk).filter_by(content_hash=content_hash).count()
        return JobStatus(
            document_id=doc.id if doc else content_hash, status=job.status,
            progress=job.progress, stage_detail=job.stage_detail,
            page_count=content.page_count if content else None,
            chunks=chunks, error=job.error,
        )
    finally:
        session.close()
```

- [ ] **Step 3: raw 系テストの Doc スタブに content を足す**

`rag/tests/test_documents_api.py` の `test_raw_streams_file` と `test_raw_head_ok_when_exists` で使う `_Doc`/`_Session` を、`get_document_raw` が `Document` と `Content` を 2 回 `session.get` する新実装に合わせる。両テストの `_Doc`/`_Session` 定義を次の形に置換（`owner` 一致ケース）:

```python
    class _Doc:
        owner_user_id = "u1"
        content_hash = "h1"
        filename = "src.pdf"

    class _Content:
        mime = "application/pdf"
        raw_path = str(pdf)

    class _Session:
        def get(self, model, _id):
            return _Doc() if model.__name__ == "Document" else _Content()
        def close(self):
            pass
```

`test_raw_404_when_not_owner` と `test_raw_head_404_when_not_owner` の `_Doc` は `owner_user_id = "owner-A"`・`content_hash = "h1"`・`filename = "x.pdf"` を持たせ、`_Session.get` は `Document` で `_Doc()` を返せばよい（owner 不一致で content 取得前に 404 になるため `_Content` は不要だが、上記と同じ `_Session` 形でも可）。

- [ ] **Step 4: fetch / preview テストを書き換える**

`rag/tests/test_fetch_document_api.py` と `rag/tests/test_documents_preview_api.py` のうち、`Document` を直接生成し `Chunk(document_id=...)` で seed している箇所を、`Content`＋`Document(content_hash=...)`＋`Chunk(content_hash=...)` に変更する。seed の最小形（両ファイルの seed 部に適用）:

```python
import uuid
from app.db import SessionLocal
from app.models import Chunk, Content, Document

def _seed_doc_with_chunks(owner="u1", n=3):
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    session.add(Content(content_hash=h, mime="application/pdf", size=10,
                        raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=h, filename="d.pdf")
    session.add(doc)
    for i in range(n):
        session.add(Chunk(content_hash=h, ordinal=i, heading_path=f"h{i}",
                          page_start=i, page_end=i, block_type="text", token_len=1,
                          text=f"chunk{i}"))
    session.commit()
    ids = (doc.id, h)
    session.close()
    return ids
```

各テストの「document を作って chunk を入れる」前処理を `doc_id, h = _seed_doc_with_chunks(owner)` に置き換え、後始末は `content_hash == h` で `Chunk`/`Document`/`Content` を削除する。API 呼び出し（`POST /documents/{doc_id}/chunks`、`GET /documents/{doc_id}/preview`）とレスポンス検証（`document_id`/`document_title`/`chunks`）はそのまま通る（`document_title` は `doc.filename = "d.pdf"`）。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run:
```bash
cd rag && uv run pytest tests/test_documents_api.py tests/test_fetch_document_api.py tests/test_documents_preview_api.py -v
```
Expected: 全 PASS。

- [ ] **Step 6: コミット**

```bash
git add rag/app/routers/documents.py rag/app/routers/jobs.py rag/tests/test_documents_api.py rag/tests/test_fetch_document_api.py rag/tests/test_documents_preview_api.py
git commit -m "$(printf 'feat: 配信・job・fetch/previewをcontent解決へ変更\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: 残りのテスト掃き出し・リセット手順・ドキュメント

**Files:**
- Modify: 残存する `document_id`/`owner_user_id`-payload 前提のテスト（`test_documents_cleanup.py`, `test_documents_rendered.py`, `test_documents_layout_api.py`, `test_documents_cursor.py`, `test_documents_list_api.py`, `test_assets_api.py`, `test_retrieve_api.py`, `test_fetch_document_api.py` 等で未修整のもの）
- Modify: `CLAUDE.md`（リセット手順を追記）

- [ ] **Step 1: rag テスト全体を流して残骸を洗い出す**

Run:
```bash
cd rag && uv run pytest -v
```
Expected: ここで失敗するのは「旧 `Document(raw_path=…, mime=…, status=…)` 直接生成」「`Chunk(document_id=…)`」「`store.*_search(..., owner_user_id, ...)`」「`delete_by_document`」を使うテスト。各失敗を以下の対応表で機械的に直す:

| 旧 | 新 |
|---|---|
| `Document(... raw_path=, mime=, size=, page_count=, status=)` | `Content(content_hash=, mime=, size=, raw_path=, status=, ref_count=1)` ＋ `Document(owner_user_id=, content_hash=, filename=)` |
| `Chunk(document_id=h, ...)` | `Chunk(content_hash=h, ...)` |
| `IngestJob(document_id=, owner_user_id=, ...)` | `IngestJob(content_hash=, ...)` |
| `store.dense_search(v, owner, k)` / `sparse_search` | `store.dense_search(v, [content_hash], k)` |
| `store.delete_by_document(id)` | `store.delete_by_content(content_hash)` |
| 配信系の `_Doc`(raw_path/mime 直持ち) | `_Doc`(content_hash/filename) ＋ `_Content`(raw_path/mime)、`_Session.get` を model 名で分岐 |

各テストファイルを 1 つずつ修正し、その都度 `cd rag && uv run pytest tests/<file> -v` で緑にする。

- [ ] **Step 2: `CLAUDE.md` にリセット手順を追記する**

`CLAUDE.md` の「### DB マイグレーション」節の直後に次のブロックを追加:

````markdown
### 横断共有への移行リセット（既存データ破棄）

コンテンツアドレス方式（`contents`/`documents` 分離）へ移行する際は、既存の重複データを
移行せず破棄する。マイグレーション適用に加えて Qdrant と原本ストレージもクリアする。

```bash
docker compose exec -T rag uv run alembic upgrade head   # 旧 documents/chunks/ingest_jobs を破棄し再構築
# Qdrant コレクション削除（worker が次回 ensure_collection で payload index 付き再作成）
docker compose exec -T rag python -c "from app.vectorstore.qdrant import QdrantStore; QdrantStore().drop()"
# 原本・派生物のアップロード領域をクリア
docker compose exec -T rag sh -c 'rm -rf /data/uploads/*'
```
````

- [ ] **Step 3: rag テスト全体が緑になることを確認する**

Run:
```bash
cd rag && uv run pytest -q
```
Expected: 全 PASS（失敗 0）。

- [ ] **Step 4: web 側に影響がないことを確認する（型・lint）**

Run:
```bash
pnpm exec tsc --noEmit && pnpm lint
```
Expected: いずれもエラーなし（web 改修は無いはずで、回帰がないことの確認）。

- [ ] **Step 5: コミット**

```bash
git add rag/tests CLAUDE.md
git commit -m "$(printf 'test: 残テストをcontent_hash前提へ更新しリセット手順を追記\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 完了条件

- 別ユーザーが同一バイトを上げても、解析・埋め込みは 1 回だけ・原本はディスク 1 個・`contents.ref_count` が参照数を反映する。
- 検索は各ユーザーに自分の `document_id`/`filename` で結果が返り、参照を持たないユーザーには共有 content がヒットしない。
- 1 ユーザーの削除で他ユーザーの可視性は不変、最後の参照削除で実体・ベクトル・ファイルが GC される。
- `cd rag && uv run pytest -q` が全 PASS、web の `tsc --noEmit` / `lint` がエラーなし。
```
