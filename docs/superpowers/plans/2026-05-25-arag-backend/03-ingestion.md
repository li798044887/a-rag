# フェーズ3: インジェストパイプライン（非同期）

> 前提・共通規約は [README.md](./README.md) を参照。

**このフェーズのゴール:** アップロード → MinerU 解析 → semantic-loss 抑制チャンク化 → BGE-M3 埋め込み → Qdrant upsert を arq で非同期実行し、進捗を UI に反映する。

**設計上の要点:** MinerU の具体 API は実装時に公式ドキュメントで確認する（学習データと差異の可能性）。本パイプラインは **MinerU 出力を自前の `ParsedBlock` に正規化**し、チャンカは `ParsedBlock` 列に対して動作する。これによりチャンカ（中核ロジック）は MinerU 非依存でゴールデンテスト可能になる。

**依存:** フェーズ1, 2

**作成/変更するファイル:**
- Create: `rag/app/db.py`, `rag/app/models.py`, `rag/app/schemas.py`, `rag/alembic.ini`, `rag/alembic/`（init）
- Create: `rag/app/parsing/__init__.py`, `rag/app/parsing/types.py`, `rag/app/parsing/mineru.py`
- Create: `rag/app/chunking/__init__.py`, `rag/app/chunking/chunker.py`
- Create: `rag/app/embedding/__init__.py`, `rag/app/embedding/base.py`, `rag/app/embedding/bge_m3.py`, `rag/app/embedding/factory.py`
- Create: `rag/app/vectorstore/__init__.py`, `rag/app/vectorstore/qdrant.py`
- Create: `rag/app/queue.py`, `rag/app/worker.py`
- Create: `rag/app/security.py`（内部トークン依存）, `rag/app/routers/__init__.py`, `rag/app/routers/documents.py`, `rag/app/routers/jobs.py`
- Modify: `rag/app/main.py`（ルータ登録）, `rag/pyproject.toml`（依存）
- Create: `rag/tests/test_chunker.py`, `rag/tests/test_documents_api.py`, `rag/tests/conftest.py`
- Create/Modify (web): `src/app/api/upload/route.ts`, `src/app/api/uploads/[id]/route.ts`, `src/lib/rag-client.ts`, `src/hooks/use-uploads.ts`

---

### Task 1: rag DB モデルと Alembic

**Files:**
- Create: `rag/app/db.py`, `rag/app/models.py`, `rag/alembic.ini`, `rag/alembic/env.py`, `rag/alembic/versions/`
- Modify: `rag/pyproject.toml`

- [ ] **Step 1: 依存を追加**

`rag/pyproject.toml` の `dependencies` に追記し `uv sync`:
```toml
  "sqlalchemy>=2.0",
  "psycopg[binary]>=3.2",
  "alembic>=1.13",
```
Run: `cd rag && uv sync --group dev`

- [ ] **Step 2: DB セッションを実装**

`rag/app/db.py`:
```python
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
```

- [ ] **Step 3: モデルを実装**

`rag/app/models.py`:
```python
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, index=True)
    filename: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    raw_path: Mapped[str] = mapped_column(String)
    parsed_md_path: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    chunks: Mapped[list["Chunk"]] = relationship(back_populates="document")


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    heading_path: Mapped[str] = mapped_column(Text, default="")
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    block_type: Mapped[str] = mapped_column(String)
    token_len: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    document: Mapped[Document] = relationship(back_populates="chunks")


class IngestJob(Base):
    __tablename__ = "ingest_jobs"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    owner_user_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0–100
    stage_detail: Mapped[str] = mapped_column(String, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

- [ ] **Step 4: Alembic 初期化と初回マイグレーション**

Run:
```bash
cd rag && uv run alembic init alembic
```
`rag/alembic/env.py` を編集し、`target_metadata` をモデルへ接続（既存テンプレの該当箇所を置換）:
```python
from app.config import settings
from app.db import Base
from app import models  # noqa: F401  (モデル登録のため import)

config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
```
Run:
```bash
cd rag && uv run alembic revision --autogenerate -m "documents chunks ingest_jobs"
cd rag && uv run alembic upgrade head
```
Expected: 3 テーブルが作成される。`psql` で `\dt` に表示。

- [ ] **Step 5: コミット**

```bash
git add rag/app/db.py rag/app/models.py rag/alembic.ini rag/alembic rag/pyproject.toml rag/uv.lock
git commit -m "feat: rag の DB モデル（documents/chunks/ingest_jobs）と Alembic を追加"
```

---

### Task 2: レイアウト認識チャンカ（中核・TDD）

**Files:**
- Create: `rag/app/parsing/__init__.py`, `rag/app/parsing/types.py`, `rag/app/chunking/__init__.py`, `rag/app/chunking/chunker.py`
- Create: `rag/tests/test_chunker.py`

- [ ] **Step 1: 正規化型を定義**

`rag/app/parsing/__init__.py`: 空。

`rag/app/parsing/types.py`:
```python
from dataclasses import dataclass


@dataclass
class ParsedBlock:
    """MinerU 出力を正規化した 1 ブロック。"""
    type: str  # "title" | "text" | "table" | "equation" | "image"
    text: str = ""
    level: int | None = None  # title のときの見出しレベル（1 が最上位）
    page: int = 0
    html: str | None = None   # table の HTML
    latex: str | None = None  # equation の LaTeX
    caption: str | None = None  # table/image のキャプション


@dataclass
class ParsedDocument:
    blocks: list[ParsedBlock]
    page_count: int


@dataclass
class Chunk:
    ordinal: int
    heading_path: str
    page_start: int
    page_end: int
    block_type: str  # "text" | "table" | "equation" | "image"
    text: str
    token_len: int
```

- [ ] **Step 2: 失敗するテストを書く**

`rag/tests/test_chunker.py`:
```python
from app.parsing.types import ParsedBlock
from app.chunking.chunker import chunk_blocks, estimate_tokens


def title(text, level):
    return ParsedBlock(type="title", text=text, level=level, page=0)


def text(t, page=0):
    return ParsedBlock(type="text", text=t, page=page)


def test_estimate_tokens_counts_cjk_per_char():
    assert estimate_tokens("あいうえお") == 5
    assert estimate_tokens("hello world") == 2  # 2 語


def test_heading_path_is_built_from_title_hierarchy():
    blocks = [
        title("設計指針", 1),
        title("認証", 2),
        text("トークンは 24 時間で失効する。"),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 1
    assert chunks[0].heading_path == "設計指針 > 認証"
    assert "トークンは" in chunks[0].text


def test_sibling_title_pops_same_level():
    blocks = [
        title("設計指針", 1),
        title("認証", 2),
        text("A。"),
        title("ロギング", 2),  # 認証(level2) を pop して置換
        text("B。"),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    paths = [c.heading_path for c in chunks]
    assert paths == ["設計指針 > 認証", "設計指針 > ロギング"]


def test_table_is_an_atomic_chunk_with_heading_and_caption():
    blocks = [
        title("売上", 1),
        ParsedBlock(type="table", html="<table><tr><td>Q1</td></tr></table>",
                    caption="四半期売上", page=2),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 1
    c = chunks[0]
    assert c.block_type == "table"
    assert "四半期売上" in c.text          # キャプション同梱
    assert "<table>" in c.text             # HTML を分割しない
    assert c.heading_path == "売上"
    assert c.page_start == 2 and c.page_end == 2


def test_long_text_splits_on_sentence_boundary_with_overlap():
    body = "".join(f"これは第{i}文です。" for i in range(1, 11))  # 10 文
    blocks = [title("章", 1), text(body)]
    chunks = chunk_blocks(blocks, target_tokens=30, overlap_sentences=1)
    assert len(chunks) >= 2
    # 文の途中で切れない（必ず「。」で終わる）
    for c in chunks:
        assert c.text.rstrip().endswith("。")
    # オーバーラップ: 隣接チャンクが 1 文を共有
    assert chunks[0].text.split("。")[-2] + "。" in chunks[1].text
```

- [ ] **Step 3: 失敗を確認**

Run: `cd rag && uv run pytest tests/test_chunker.py -v`
Expected: FAIL（`app.chunking.chunker` 未作成）

- [ ] **Step 4: チャンカを実装**

`rag/app/chunking/__init__.py`: 空。

`rag/app/chunking/chunker.py`:
```python
import re

from app.parsing.types import Chunk, ParsedBlock

_CJK = re.compile(r"[぀-ヿ一-鿿가-힣]")
_SENT_END = re.compile(r"(?<=[。！？!?])")


def estimate_tokens(text: str) -> int:
    """CJK は 1 文字 1 トークン、非 CJK は空白区切りの語数で概算。"""
    cjk = len(_CJK.findall(text))
    non_cjk = _CJK.sub(" ", text)
    words = len([w for w in non_cjk.split() if w])
    return cjk + words


def _split_sentences(text: str) -> list[str]:
    parts = [s for s in _SENT_END.split(text) if s.strip()]
    return parts or ([text] if text.strip() else [])


def _heading_path(stack: list[tuple[int, str]]) -> str:
    return " > ".join(t for _, t in stack)


def chunk_blocks(
    blocks: list[ParsedBlock],
    target_tokens: int = 700,
    overlap_sentences: int = 1,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    stack: list[tuple[int, str]] = []
    ordinal = 0

    # テキストバッファ（連続する text ブロックを束ねる）
    buf: list[str] = []
    buf_pages: list[int] = []

    def flush_text() -> None:
        nonlocal ordinal, buf, buf_pages
        if not buf:
            return
        sentences: list[str] = []
        for para in buf:
            sentences.extend(_split_sentences(para))
        pages = buf_pages or [0]
        page_start, page_end = min(pages), max(pages)

        cur: list[str] = []
        cur_tokens = 0
        for sent in sentences:
            st = estimate_tokens(sent)
            if cur and cur_tokens + st > target_tokens:
                _emit_text(cur, page_start, page_end)
                # オーバーラップ: 末尾 N 文を次へ持ち越す
                cur = cur[-overlap_sentences:] if overlap_sentences else []
                cur_tokens = sum(estimate_tokens(s) for s in cur)
            cur.append(sent)
            cur_tokens += st
        if cur:
            _emit_text(cur, page_start, page_end)
        buf = []
        buf_pages = []

    def _emit_text(sentences: list[str], page_start: int, page_end: int) -> None:
        nonlocal ordinal
        body = "".join(sentences).strip()
        if not body:
            return
        chunks.append(Chunk(
            ordinal=ordinal,
            heading_path=_heading_path(stack),
            page_start=page_start,
            page_end=page_end,
            block_type="text",
            text=body,
            token_len=estimate_tokens(body),
        ))
        ordinal += 1

    def emit_atomic(block: ParsedBlock) -> None:
        nonlocal ordinal
        if block.type == "table":
            payload = block.html or block.text
        elif block.type == "equation":
            payload = block.latex or block.text
        else:  # image
            payload = block.caption or block.text or "[image]"
        parts = []
        if block.caption and block.type != "image":
            parts.append(block.caption)
        parts.append(payload)
        body = "\n".join(parts).strip()
        chunks.append(Chunk(
            ordinal=ordinal,
            heading_path=_heading_path(stack),
            page_start=block.page,
            page_end=block.page,
            block_type=block.type,
            text=body,
            token_len=estimate_tokens(body),
        ))
        ordinal += 1

    for block in blocks:
        if block.type == "title":
            flush_text()
            lvl = block.level or 1
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            stack.append((lvl, block.text))
        elif block.type in ("table", "equation", "image"):
            flush_text()
            emit_atomic(block)
        else:  # text
            if block.text.strip():
                buf.append(block.text)
                buf_pages.append(block.page)
    flush_text()
    return chunks
```

- [ ] **Step 5: 合格を確認**

Run: `cd rag && uv run pytest tests/test_chunker.py -v`
Expected: `5 passed`

- [ ] **Step 6: コミット**

```bash
git add rag/app/parsing rag/app/chunking rag/tests/test_chunker.py
git commit -m "feat: レイアウト認識チャンカ（見出し階層/原子ブロック/オーバーラップ）を追加"
```

---

### Task 3: MinerU ラッパ（正規化）

**Files:**
- Create: `rag/app/parsing/mineru.py`
- Modify: `rag/pyproject.toml`

> **実装前に必ず MinerU 公式ドキュメント / `mineru --help` で出力形式（Markdown と `*_content_list.json`、各ブロックのキー名: `type`/`text`/`text_level`/`page_idx`/`table_body`/`img_path` 等）を確認すること。** 下記のキー対応は確認結果に合わせて調整する。

- [ ] **Step 1: MinerU を追加**

`rag/pyproject.toml` の `dependencies` に追記し sync:
```toml
  "mineru",
```
Run: `cd rag && uv sync`（CPU 環境では時間がかかる。失敗時は MinerU のインストール指示に従う）

- [ ] **Step 2: ラッパを実装（content_list.json を ParsedBlock に正規化）**

`rag/app/parsing/mineru.py`:
```python
import json
import subprocess
from pathlib import Path

from app.config import settings
from app.parsing.types import ParsedBlock, ParsedDocument

# content_list.json の type → ParsedBlock.type
_TYPE_MAP = {
    "text": "text",
    "title": "title",
    "table": "table",
    "equation": "equation",
    "interline_equation": "equation",
    "image": "image",
}


def _block_from_item(item: dict) -> ParsedBlock | None:
    raw_type = item.get("type", "text")
    btype = _TYPE_MAP.get(raw_type)
    if btype is None:
        return None
    page = int(item.get("page_idx", 0))
    if btype == "title":
        return ParsedBlock(type="title", text=item.get("text", ""),
                           level=int(item.get("text_level", 1)), page=page)
    if btype == "table":
        return ParsedBlock(type="table", html=item.get("table_body", ""),
                           caption=_join(item.get("table_caption")), page=page)
    if btype == "equation":
        return ParsedBlock(type="equation", latex=item.get("text", ""), page=page)
    if btype == "image":
        return ParsedBlock(type="image", caption=_join(item.get("img_caption")), page=page)
    return ParsedBlock(type="text", text=item.get("text", ""), page=page)


def _join(value) -> str | None:
    if value is None:
        return None
    return " ".join(value) if isinstance(value, list) else str(value)


def parse(file_path: str, out_dir: str) -> ParsedDocument:
    """MinerU CLI を実行し content_list.json を正規化して返す。"""
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["mineru", "-p", file_path, "-o", out_dir, "-d", settings.device],
        check=True,
    )
    content_list = next(Path(out_dir).rglob("*_content_list.json"))
    items = json.loads(content_list.read_text(encoding="utf-8"))
    blocks = [b for b in (_block_from_item(it) for it in items) if b is not None]
    page_count = max((b.page for b in blocks), default=0) + 1
    return ParsedDocument(blocks=blocks, page_count=page_count)
```

- [ ] **Step 3: 正規化の単体テスト（MinerU 実行なし）**

`rag/tests/test_mineru_normalize.py`:
```python
from app.parsing.mineru import _block_from_item


def test_title_item_maps_to_title_block_with_level():
    b = _block_from_item({"type": "title", "text": "概要", "text_level": 2, "page_idx": 1})
    assert b.type == "title" and b.level == 2 and b.page == 1


def test_table_item_keeps_html_and_caption():
    b = _block_from_item({"type": "table", "table_body": "<table></table>",
                          "table_caption": ["表1"], "page_idx": 0})
    assert b.type == "table" and b.html == "<table></table>" and b.caption == "表1"


def test_unknown_type_is_dropped():
    assert _block_from_item({"type": "page_footer", "text": "1"}) is None
```

- [ ] **Step 4: 合格を確認**

Run: `cd rag && uv run pytest tests/test_mineru_normalize.py -v`
Expected: `3 passed`

- [ ] **Step 5: 実 MinerU 結合の手動確認（任意・GPU 推奨）**

サンプル PDF を用意し:
```bash
cd rag && uv run python -c "from app.parsing.mineru import parse; d=parse('sample.pdf','/tmp/mineru_out'); print(d.page_count, len(d.blocks), d.blocks[:3])"
```
Expected: ページ数とブロック列が表示される。キー名が想定と異なれば `_TYPE_MAP`/`_block_from_item` を調整。

- [ ] **Step 6: コミット**

```bash
git add rag/app/parsing/mineru.py rag/tests/test_mineru_normalize.py rag/pyproject.toml rag/uv.lock
git commit -m "feat: MinerU ラッパ（content_list を ParsedBlock へ正規化）を追加"
```

---

### Task 4: 埋め込み抽象（BGE-M3、テスト用スタブ可能）

**Files:**
- Create: `rag/app/embedding/__init__.py`, `rag/app/embedding/base.py`, `rag/app/embedding/bge_m3.py`, `rag/app/embedding/factory.py`
- Create: `rag/tests/test_embedding_factory.py`
- Modify: `rag/pyproject.toml`

- [ ] **Step 1: インターフェースを定義**

`rag/app/embedding/__init__.py`: 空。

`rag/app/embedding/base.py`:
```python
from dataclasses import dataclass
from typing import Protocol


@dataclass
class DenseSparse:
    dense: list[float]
    sparse: dict[int, float]  # token id -> weight


class Embedder(Protocol):
    dim: int

    def embed(self, texts: list[str]) -> list[DenseSparse]: ...
```

- [ ] **Step 2: 失敗するテスト（ファクトリがスタブを返す）**

`rag/tests/test_embedding_factory.py`:
```python
from app.embedding.base import DenseSparse
from app.embedding.factory import StubEmbedder, get_embedder


def test_stub_embedder_is_deterministic():
    e = StubEmbedder(dim=8)
    a = e.embed(["hello"])[0]
    b = e.embed(["hello"])[0]
    assert isinstance(a, DenseSparse)
    assert len(a.dense) == 8
    assert a.dense == b.dense


def test_factory_returns_stub_when_embedder_is_stub(monkeypatch):
    monkeypatch.setenv("EMBEDDER", "stub")
    e = get_embedder()
    assert isinstance(e, StubEmbedder)
```

- [ ] **Step 3: 失敗を確認**

Run: `cd rag && uv run pytest tests/test_embedding_factory.py -v`
Expected: FAIL（`app.embedding.factory` 未作成）

- [ ] **Step 4: 実装（BGE-M3 は遅延 import、スタブを用意）**

`rag/app/embedding/factory.py`:
```python
import hashlib
import os

from app.embedding.base import DenseSparse, Embedder


class StubEmbedder:
    """テスト/オフライン用の決定的スタブ。"""
    def __init__(self, dim: int = 8):
        self.dim = dim

    def embed(self, texts: list[str]) -> list[DenseSparse]:
        out = []
        for t in texts:
            h = hashlib.sha256(t.encode()).digest()
            dense = [((h[i % len(h)]) / 255.0) for i in range(self.dim)]
            sparse = {b: 1.0 for b in set(h[:4])}
            out.append(DenseSparse(dense=dense, sparse=sparse))
        return out


def get_embedder() -> Embedder:
    kind = os.getenv("EMBEDDER", "bge-m3")
    if kind == "stub":
        return StubEmbedder()
    if kind == "bge-m3":
        from app.embedding.bge_m3 import BGEM3Embedder
        return BGEM3Embedder()
    raise ValueError(f"unknown EMBEDDER: {kind}")
```

`rag/app/embedding/bge_m3.py`:
```python
from app.config import settings
from app.embedding.base import DenseSparse


class BGEM3Embedder:
    dim = 1024

    def __init__(self):
        from FlagEmbedding import BGEM3FlagModel
        use_fp16 = settings.device == "cuda"
        self.model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=use_fp16, device=settings.device)

    def embed(self, texts: list[str]) -> list[DenseSparse]:
        out = self.model.encode(texts, return_dense=True, return_sparse=True)
        dense = out["dense_vecs"]
        sparse = out["lexical_weights"]
        return [
            DenseSparse(
                dense=[float(x) for x in dense[i]],
                sparse={int(k): float(v) for k, v in sparse[i].items()},
            )
            for i in range(len(texts))
        ]
```

`rag/pyproject.toml` の `dependencies` に追記（CPU でも動くが重い）:
```toml
  "FlagEmbedding>=1.3",
```
Run: `cd rag && uv sync`

- [ ] **Step 5: 合格を確認**

Run: `cd rag && uv run pytest tests/test_embedding_factory.py -v`
Expected: `2 passed`

- [ ] **Step 6: コミット**

```bash
git add rag/app/embedding rag/tests/test_embedding_factory.py rag/pyproject.toml rag/uv.lock
git commit -m "feat: 埋め込み抽象（BGE-M3 + テスト用スタブ）を追加"
```

---

### Task 5: Qdrant ベクトルストア

**Files:**
- Create: `rag/app/vectorstore/__init__.py`, `rag/app/vectorstore/qdrant.py`
- Create: `rag/tests/test_qdrant_store.py`
- Modify: `rag/pyproject.toml`

- [ ] **Step 1: qdrant-client を追加**

`rag/pyproject.toml` に追記し sync:
```toml
  "qdrant-client>=1.12",
```

- [ ] **Step 2: 失敗するテスト（要 `docker compose up -d qdrant`）**

`rag/tests/test_qdrant_store.py`:
```python
import uuid

from app.embedding.base import DenseSparse
from app.vectorstore.qdrant import QdrantStore

COLL = "test_arag_" + uuid.uuid4().hex[:8]


def test_ensure_collection_and_upsert_then_count():
    store = QdrantStore(collection=COLL, dim=8)
    store.ensure_collection()
    store.upsert([
        {
            "chunk_id": str(uuid.uuid4()),
            "document_id": "doc1",
            "owner_user_id": "user1",
            "heading_path": "A > B",
            "page_start": 0, "page_end": 0,
            "block_type": "text",
            "source_type": "doc",
            "text": "hello",
            "vector": DenseSparse(dense=[0.1] * 8, sparse={1: 0.5, 2: 0.3}),
        }
    ])
    assert store.count() == 1
    store.drop()
```

- [ ] **Step 3: 失敗を確認**

Run: `cd rag && docker compose up -d qdrant && uv run pytest tests/test_qdrant_store.py -v`
Expected: FAIL（`app.vectorstore.qdrant` 未作成）

- [ ] **Step 4: 実装**

`rag/app/vectorstore/__init__.py`: 空。

`rag/app/vectorstore/qdrant.py`:
```python
from qdrant_client import QdrantClient, models

from app.config import settings
from app.embedding.base import DenseSparse

DENSE = "dense"
SPARSE = "lexical"


class QdrantStore:
    def __init__(self, collection: str = "arag_chunks", dim: int = 1024):
        self.collection = collection
        self.dim = dim
        self.client = QdrantClient(url=settings.qdrant_url)

    def ensure_collection(self) -> None:
        if self.client.collection_exists(self.collection):
            return
        self.client.create_collection(
            self.collection,
            vectors_config={DENSE: models.VectorParams(size=self.dim, distance=models.Distance.COSINE)},
            sparse_vectors_config={SPARSE: models.SparseVectorParams()},
        )

    def upsert(self, rows: list[dict]) -> None:
        points = []
        for r in rows:
            vec: DenseSparse = r["vector"]
            payload = {k: r[k] for k in (
                "chunk_id", "document_id", "owner_user_id", "heading_path",
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

    def drop(self) -> None:
        self.client.delete_collection(self.collection)
```

- [ ] **Step 5: 合格を確認**

Run: `cd rag && uv run pytest tests/test_qdrant_store.py -v`
Expected: `1 passed`

- [ ] **Step 6: コミット**

```bash
git add rag/app/vectorstore rag/tests/test_qdrant_store.py rag/pyproject.toml rag/uv.lock
git commit -m "feat: Qdrant ベクトルストア（dense+sparse named vectors）を追加"
```

---

### Task 6: arq ワーカー（インジェストパイプライン + 進捗）

**Files:**
- Create: `rag/app/queue.py`, `rag/app/worker.py`
- Create: `rag/tests/test_worker_pipeline.py`
- Modify: `rag/pyproject.toml`

- [ ] **Step 1: arq を追加**

`rag/pyproject.toml` に追記し sync:
```toml
  "arq>=0.26",
```

- [ ] **Step 2: パイプライン関数を「解析関数を注入可能」に設計し、失敗テストを書く**

ワーカーの中核 `run_ingest(session, store, embedder, parse_fn, document_id, ...)` を純関数的に切り出し、`parse_fn` を注入してテスト時は MinerU を使わずスタブ解析にする。

`rag/tests/test_worker_pipeline.py`（要 qdrant 起動、DB は本番テーブル使用）:
```python
import uuid

from app.db import SessionLocal
from app.models import Chunk, Document, IngestJob
from app.parsing.types import ParsedBlock, ParsedDocument
from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore
from app.worker import run_ingest

COLL = "test_ingest_" + uuid.uuid4().hex[:8]


def fake_parse(path, out_dir):
    return ParsedDocument(
        blocks=[ParsedBlock(type="title", text="章", level=1),
                ParsedBlock(type="text", text="本文です。", page=0)],
        page_count=1,
    )


def test_run_ingest_persists_chunks_and_marks_ready():
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="x.pdf", mime="application/pdf",
                   size=10, raw_path="/tmp/x.pdf", status="queued")
    session.add(doc)
    session.flush()
    job = IngestJob(document_id=doc.id, owner_user_id="u1", status="queued")
    session.add(job)
    session.commit()

    store = QdrantStore(collection=COLL, dim=8)
    run_ingest(session, store, StubEmbedder(dim=8), fake_parse, doc.id, job.id)

    session.refresh(doc)
    session.refresh(job)
    assert doc.status == "ready"
    assert job.status == "ready" and job.progress == 100
    n_chunks = session.query(Chunk).filter_by(document_id=doc.id).count()
    assert n_chunks >= 1
    assert store.count() == n_chunks

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(IngestJob).filter_by(id=job.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit()
    session.close()
```

- [ ] **Step 3: 失敗を確認**

Run: `cd rag && uv run pytest tests/test_worker_pipeline.py -v`
Expected: FAIL（`app.worker` 未作成）

- [ ] **Step 4: 実装**

`rag/app/queue.py`:
```python
from arq.connections import RedisSettings

from app.config import settings


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)
```

`rag/app/worker.py`:
```python
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from app.chunking.chunker import chunk_blocks
from app.config import settings
from app.db import SessionLocal
from app.embedding.base import Embedder
from app.embedding.factory import get_embedder
from app.models import Chunk, Document, IngestJob
from app.parsing.mineru import parse as mineru_parse
from app.parsing.types import ParsedDocument
from app.queue import redis_settings
from app.vectorstore.qdrant import QdrantStore

ParseFn = Callable[[str, str], ParsedDocument]


def _set(job: IngestJob, doc: Document, session: Session, *,
         status: str, progress: int, detail: str = "") -> None:
    job.status = status
    job.progress = progress
    job.stage_detail = detail
    doc.status = status if status in ("ready", "error") else "processing"
    session.commit()


def run_ingest(session: Session, store: QdrantStore, embedder: Embedder,
               parse_fn: ParseFn, document_id: str, job_id: str) -> None:
    doc = session.get(Document, document_id)
    job = session.get(IngestJob, job_id)
    assert doc and job
    try:
        store.ensure_collection()

        _set(job, doc, session, status="parsing", progress=10, detail="MinerU 解析中")
        out_dir = str(Path(doc.raw_path).with_suffix("")) + "_mineru"
        parsed = parse_fn(doc.raw_path, out_dir)
        doc.page_count = parsed.page_count

        _set(job, doc, session, status="chunking", progress=40, detail="チャンク化")
        chunks = chunk_blocks(parsed.blocks)
        rows = []
        for ch in chunks:
            row = Chunk(document_id=doc.id, ordinal=ch.ordinal, heading_path=ch.heading_path,
                        page_start=ch.page_start, page_end=ch.page_end,
                        block_type=ch.block_type, token_len=ch.token_len, text=ch.text)
            session.add(row)
            rows.append((row, ch))
        session.flush()

        _set(job, doc, session, status="embedding", progress=70, detail="埋め込み生成")
        texts = [f"{ch.heading_path}\n\n{ch.text}".strip() for _, ch in rows]
        vectors = embedder.embed(texts) if texts else []

        _set(job, doc, session, status="indexing", progress=90, detail="索引化")
        store.upsert([
            {
                "chunk_id": row.id, "document_id": doc.id, "owner_user_id": doc.owner_user_id,
                "heading_path": ch.heading_path, "page_start": ch.page_start, "page_end": ch.page_end,
                "block_type": ch.block_type, "source_type": "doc", "text": ch.text,
                "vector": vectors[i],
            }
            for i, (row, ch) in enumerate(rows)
        ])

        _set(job, doc, session, status="ready", progress=100, detail="完了")
    except Exception as exc:  # noqa: BLE001
        job.status = "error"
        job.error = str(exc)
        doc.status = "error"
        session.commit()
        raise


async def ingest_document(ctx: dict, document_id: str, job_id: str) -> None:
    session = SessionLocal()
    try:
        store = QdrantStore(dim=get_embedder().dim if settings.embedder != "stub" else 1024)
        run_ingest(session, store, get_embedder(), mineru_parse, document_id, job_id)
    finally:
        session.close()


class WorkerSettings:
    functions = [ingest_document]
    redis_settings = redis_settings()
```

> 注: テストの `run_ingest` は同期関数。arq の `ingest_document` がそれをラップして DI する。

- [ ] **Step 5: 合格を確認**

Run: `cd rag && uv run pytest tests/test_worker_pipeline.py -v`
Expected: `1 passed`

- [ ] **Step 6: コミット**

```bash
git add rag/app/queue.py rag/app/worker.py rag/tests/test_worker_pipeline.py rag/pyproject.toml rag/uv.lock
git commit -m "feat: arq インジェストパイプライン（解析→チャンク→埋め込み→索引・進捗更新）を追加"
```

---

### Task 7: documents / jobs ルータ（内部認証 + enqueue）

**Files:**
- Create: `rag/app/security.py`, `rag/app/schemas.py`, `rag/app/routers/__init__.py`, `rag/app/routers/documents.py`, `rag/app/routers/jobs.py`
- Modify: `rag/app/main.py`
- Create: `rag/tests/test_documents_api.py`, `rag/tests/conftest.py`

- [ ] **Step 1: 内部トークン依存とスキーマ**

`rag/app/security.py`:
```python
from fastapi import Header, HTTPException

from app.config import settings


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    if x_internal_token != settings.rag_internal_token:
        raise HTTPException(status_code=401, detail="invalid internal token")
```

`rag/app/schemas.py`:
```python
from pydantic import BaseModel


class IngestStarted(BaseModel):
    document_id: str
    job_id: str


class JobStatus(BaseModel):
    document_id: str
    status: str
    progress: int
    stage_detail: str
    page_count: int | None = None
    chunks: int = 0
    error: str | None = None
```

- [ ] **Step 2: 失敗するテスト（enqueue はモック）**

`rag/tests/conftest.py`:
```python
import pytest
from fastapi.testclient import TestClient

from app.main import app

TOKEN = "dev-internal-token"


@pytest.fixture
def client():
    return TestClient(app)
```

`rag/tests/test_documents_api.py`:
```python
import io

from app.config import settings


def test_upload_requires_internal_token(client):
    res = client.post("/documents", files={"file": ("a.pdf", b"x", "application/pdf")},
                      data={"owner_user_id": "u1"})
    assert res.status_code == 401


def test_upload_creates_doc_and_enqueues(client, monkeypatch):
    enqueued = {}

    async def fake_enqueue(name, *args):
        enqueued["args"] = args

    monkeypatch.setattr("app.routers.documents.enqueue_ingest", fake_enqueue)
    res = client.post(
        "/documents",
        headers={"x-internal-token": settings.rag_internal_token},
        files={"file": ("a.pdf", io.BytesIO(b"hello"), "application/pdf")},
        data={"owner_user_id": "u1"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["document_id"] and body["job_id"]
    assert enqueued["args"][0] == body["document_id"]

    status = client.get(f"/jobs/{body['job_id']}",
                        headers={"x-internal-token": settings.rag_internal_token})
    assert status.status_code == 200
    assert status.json()["status"] in ("queued", "parsing")
```

- [ ] **Step 3: 失敗を確認**

Run: `cd rag && uv run pytest tests/test_documents_api.py -v`
Expected: FAIL（ルータ未登録 → 404/ImportError）

- [ ] **Step 4: ルータを実装**

`rag/app/routers/__init__.py`: 空。

`rag/app/routers/documents.py`:
```python
import uuid
from pathlib import Path

from arq import create_pool
from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.db import SessionLocal
from app.models import Document, IngestJob
from app.queue import redis_settings
from app.schemas import IngestStarted
from app.security import require_internal_token

router = APIRouter()
UPLOAD_DIR = Path("/data/uploads")


async def enqueue_ingest(document_id: str, job_id: str) -> None:
    pool = await create_pool(redis_settings())
    await pool.enqueue_job("ingest_document", document_id, job_id)


@router.post("/documents", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def create_document(file: UploadFile = File(...), owner_user_id: str = Form(...)):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = UPLOAD_DIR / f"{uuid.uuid4().hex}_{file.filename}"
    raw_path.write_bytes(await file.read())

    session = SessionLocal()
    try:
        doc = Document(owner_user_id=owner_user_id, filename=file.filename or "file",
                       mime=file.content_type or "application/octet-stream",
                       size=raw_path.stat().st_size, raw_path=str(raw_path), status="queued")
        session.add(doc)
        session.flush()
        job = IngestJob(document_id=doc.id, owner_user_id=owner_user_id, status="queued")
        session.add(job)
        session.commit()
        result = IngestStarted(document_id=doc.id, job_id=job.id)
    finally:
        session.close()

    await enqueue_ingest(result.document_id, result.job_id)
    return result
```

`rag/app/routers/jobs.py`:
```python
from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionLocal
from app.models import Chunk, Document, IngestJob
from app.schemas import JobStatus
from app.security import require_internal_token

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatus,
            dependencies=[Depends(require_internal_token)])
def get_job(job_id: str):
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        doc = session.get(Document, job.document_id)
        chunks = session.query(Chunk).filter_by(document_id=job.document_id).count()
        return JobStatus(
            document_id=job.document_id, status=job.status, progress=job.progress,
            stage_detail=job.stage_detail, page_count=doc.page_count if doc else None,
            chunks=chunks, error=job.error,
        )
    finally:
        session.close()
```

`rag/app/main.py` を更新:
```python
from fastapi import FastAPI

from app.routers import documents, jobs

app = FastAPI(title="ARag RAG service")
app.include_router(documents.router)
app.include_router(jobs.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "models_loaded": False}
```

- [ ] **Step 5: 合格を確認**

Run: `cd rag && uv run pytest tests/test_documents_api.py -v`
Expected: `2 passed`

- [ ] **Step 6: 全 rag テストと手動 e2e（任意）**

Run: `cd rag && uv run pytest -v`
Expected: 全 green。
（任意）`docker compose up -d` 後、`rag-worker` を起動し、実 PDF を `/documents` に投げてジョブが `ready` まで進むことを確認。

- [ ] **Step 7: コミット**

```bash
git add rag/app/security.py rag/app/schemas.py rag/app/routers rag/app/main.py rag/tests/conftest.py rag/tests/test_documents_api.py
git commit -m "feat: documents/jobs ルータ（内部認証・enqueue・進捗取得）を追加"
```

---

### Task 8: web のアップロード転送と進捗ポーリング

**Files:**
- Create: `src/lib/rag-client.ts`, `src/app/api/uploads/[id]/route.ts`
- Modify: `src/app/api/upload/route.ts`, `src/hooks/use-uploads.ts`
- Create: `src/lib/rag-client.test.ts`

- [ ] **Step 1: rag-client（失敗テスト先行）**

`src/lib/rag-client.test.ts`:
```ts
import { afterEach, expect, test, vi } from "vitest";
import { ragFetch } from "@/lib/rag-client";

afterEach(() => vi.restoreAllMocks());

test("ragFetch attaches internal token header and base url", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  process.env.RAG_SERVICE_URL = "http://rag:8000";
  process.env.RAG_INTERNAL_TOKEN = "tok";

  await ragFetch("/jobs/abc");
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("http://rag:8000/jobs/abc");
  expect((init?.headers as Record<string, string>)["x-internal-token"]).toBe("tok");
});
```

- [ ] **Step 2: 失敗を確認 → 実装**

Run: `pnpm test src/lib/rag-client.test.ts` → FAIL

`src/lib/rag-client.ts`:
```ts
const base = () => process.env.RAG_SERVICE_URL || "http://localhost:8000";
const token = () => process.env.RAG_INTERNAL_TOKEN || "dev-internal-token";

/** Server-only fetch to the rag service with the internal auth header. */
export async function ragFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(base() + path, {
    ...init,
    headers: { "x-internal-token": token(), ...(init.headers || {}) },
  });
}
```
Run: `pnpm test src/lib/rag-client.test.ts` → PASS

- [ ] **Step 3: upload ルートを「rag へ転送」に置換**

`src/app/api/upload/route.ts` を置換（認証は維持、ファイルを rag `/documents` へ転送し `{documentId, jobId}` を返す）:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const fwd = new FormData();
  fwd.append("file", file);
  fwd.append("owner_user_id", claims.sub);

  const res = await ragFetch("/documents", { method: "POST", body: fwd });
  if (!res.ok) {
    return NextResponse.json({ error: "索引化の開始に失敗しました" }, { status: 502 });
  }
  const data = (await res.json()) as { document_id: string; job_id: string };
  return NextResponse.json({ documentId: data.document_id, jobId: data.job_id });
}
```

- [ ] **Step 4: ジョブ状態プロキシ**

`src/app/api/uploads/[id]/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  if (!token || !(await verifyAccessToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(`/jobs/${id}`);
  if (!res.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await res.json());
}
```
> Next.js 16 の dynamic params が `Promise` である点に注意（実装直前に `node_modules/next/dist/docs/` で確認）。

- [ ] **Step 5: use-uploads を実進捗ポーリングに変更**

`src/hooks/use-uploads.ts` を変更: アップロード POST 後に返る `jobId` を保持し、`status==="processing"` の間 `GET /api/uploads/:jobId` を ~1 秒間隔でポーリング。レスポンスの `progress/status/page_count/chunks` を `StagedFile` にマップ。`ready`/`error` で停止・トースト。クライアント側の擬似進捗アニメーション（90% まで埋める tick）は upload 完了までに限定し、processing 以降は実 `progress` を反映する。既存の `timers`/`clearTimers`/`setFiles` パターンを流用する。

擬似コード（実装の要点）:
```ts
// upload 成功時:
const { jobId } = await res.json();
setFiles(prev => prev.map(f => f.id === id ? { ...f, status: "processing", progress: 100, jobId } : f));
const poll = setInterval(async () => {
  const r = await fetch(`/api/uploads/${jobId}`);
  if (!r.ok) return;
  const j = await r.json(); // {status, progress, page_count, chunks, error}
  setFiles(prev => prev.map(f => f.id === id
    ? { ...f, progress: j.progress, pages: j.page_count, chunks: j.chunks,
        status: j.status === "ready" ? "ready" : j.status === "error" ? "error" : "processing",
        error: j.error ?? undefined }
    : f));
  if (j.status === "ready") { clearTimers(id); onToast?.(`「${file.name}」を索引化しました`, "success"); }
  if (j.status === "error") { clearTimers(id); onToast?.(j.error || "索引化に失敗しました", "error"); }
}, 1000);
timers.current[id] = [poll];
```
（`StagedFile` に `jobId?: string` を追加する場合は `src/lib/types.ts` も更新。）

- [ ] **Step 6: 手動 e2e 確認**

`docker compose up -d` + `rag-worker` 起動 + `pnpm dev`。ログイン後、PDF をアップロード → 進捗バーが parsing→chunking→embedding→indexing→ready と実値で進むことを確認。

- [ ] **Step 7: lint + テスト + コミット**

Run: `pnpm lint && pnpm test`
```bash
git add src/lib/rag-client.ts src/lib/rag-client.test.ts src/app/api/upload/route.ts src/app/api/uploads src/hooks/use-uploads.ts src/lib/types.ts
git commit -m "feat: アップロードを rag へ転送し実進捗をポーリング表示"
```

---

## フェーズ3 完了条件
- `cd rag && uv run pytest` が green（chunker/normalize/embedding/qdrant/worker/api）
- 実 PDF アップロードで documents/chunks/ingest_jobs に行が入り、Qdrant にベクトルが入る
- UI 進捗が実ジョブの値で更新され `ready` で索引数を表示
