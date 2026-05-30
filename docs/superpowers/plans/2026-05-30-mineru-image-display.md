# MinerU 抽出画像の実表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MinerU が抽出した画像を一次資料パネルで `[image]` の代わりに実画像として表示する。

**Architecture:** rag パイプラインが画像パスを保持し、画像ファイルを文書ごとの安定ディレクトリ（`{raw_path}_assets/images/`）へコピーする。画像チャンクは表示専用（埋め込み・Qdrant 索引から除外、Postgres 行は順序保持のため維持）。チャンク本文には相対 markdown 画像 `![](images/x.jpg)` を焼き込み、Next.js の `tools.ts`（snippet 生成・DB 永続化前の唯一のチョークポイント）で絶対 API パスへ書き換える。フロントは markdown 画像をパースして `<img>` を描画する。

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy / pytest（rag）、Next.js（App Router, runtime=nodejs）/ TypeScript / Vitest / Storybook（web）。

設計仕様: `docs/superpowers/specs/2026-05-30-mineru-image-display-design.md`

**前提コマンド（worker は作業ディレクトリが永続するため毎回 `cd` を明示する）**
- rag テスト: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest <path> -v`
- web ユニット: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run --project unit <path>`
- web Storybook: `cd /Users/ansen/Documents/playground/a-rag && pnpm test:storybook`

---

## ファイル構成

**rag（変更後 `docker compose up -d --build rag` が必要／既存ドキュメントは再索引が必要）**
- `rag/app/parsing/types.py` — `ParsedBlock.image_path` と `ParsedDocument.images_dir` を追加
- `rag/app/parsing/mineru.py` — image 項目から `img_path` を取得、`images_dir` を設定
- `rag/app/chunking/chunker.py` — image チャンク本文を markdown 画像に
- `rag/app/documents_service.py` — `assets_dir_for()` と `resolve_within()`（純関数）を追加
- `rag/app/worker.py` — 画像ディレクトリのコピー＋画像チャンクを索引対象から除外
- `rag/app/routers/documents.py` — `GET /documents/{id}/assets/{path}` を追加
- テスト: `rag/tests/test_mineru_normalize.py`, `test_chunker.py`, `test_worker_pipeline.py`, `test_documents_api.py`, 新規 `test_assets_path.py`

**web**
- `src/lib/agent/image-urls.ts`（新規）— `resolveImageUrls()` 純関数
- `src/lib/agent/tools.ts` — snippet 生成 2 箇所に `resolveImageUrls` を適用
- `src/app/api/documents/[id]/assets/[...path]/route.ts`（新規）— rag へのプロキシ
- `src/components/sources/parse-section-body.ts`（新規）— 本文を segment 配列へ
- `src/components/sources/right-panel.tsx` — `SectionBody` を segment ベースに、`SectionImage` を追加
- テスト: 新規 `src/lib/agent/image-urls.test.ts`, `src/components/sources/parse-section-body.test.ts`、`right-panel.stories.tsx` にストーリー追加

---

## Task 1: パース層に画像パスを保持する

**Files:**
- Modify: `rag/app/parsing/types.py`
- Modify: `rag/app/parsing/mineru.py:33-34`, `rag/app/parsing/mineru.py:59-60`
- Test: `rag/tests/test_mineru_normalize.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_mineru_normalize.py` の末尾に追記:

```python
def test_image_item_keeps_path_and_caption():
    b = _block_from_item({"type": "image", "img_path": "images/x.jpg",
                          "img_caption": ["図1"], "page_idx": 2})
    assert b.type == "image"
    assert b.image_path == "images/x.jpg"
    assert b.caption == "図1"
    assert b.page == 2


def test_image_item_without_path_has_none():
    b = _block_from_item({"type": "image", "page_idx": 0})
    assert b.type == "image" and b.image_path is None
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_mineru_normalize.py -v`
Expected: FAIL（`ParsedBlock` に `image_path` が無く `AttributeError` / `TypeError`）

- [ ] **Step 3: `ParsedBlock` と `ParsedDocument` を拡張**

`rag/app/parsing/types.py` の `ParsedBlock` に `image_path` フィールドを追加（`caption` の下）:

```python
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
    image_path: str | None = None  # image の相対パス（例 "images/x.jpg"）
```

同ファイルの `ParsedDocument` に `images_dir` を追加:

```python
@dataclass
class ParsedDocument:
    blocks: list[ParsedBlock]
    page_count: int
    images_dir: str | None = None  # MinerU が画像を書き出したディレクトリ（images/ の親）
```

- [ ] **Step 4: `mineru.py` で img_path と images_dir を拾う**

`rag/app/parsing/mineru.py` の image 分岐（33-34 行）を置換:

```python
    if btype == "image":
        return ParsedBlock(type="image", image_path=item.get("img_path"),
                           caption=_join(item.get("img_caption")), page=page)
```

同ファイルの `parse()` 末尾の return（59-60 行付近）を置換し、content_list の親ディレクトリを `images_dir` として返す:

```python
    blocks = [b for b in (_block_from_item(it) for it in items) if b is not None]
    page_count = max((b.page for b in blocks), default=0) + 1
    return ParsedDocument(blocks=blocks, page_count=page_count,
                          images_dir=str(content_list.parent))
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_mineru_normalize.py -v`
Expected: PASS（既存 3 件＋新規 2 件）

- [ ] **Step 6: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add rag/app/parsing/types.py rag/app/parsing/mineru.py rag/tests/test_mineru_normalize.py
git commit -m "feat: パース層で画像パスと出力ディレクトリを保持する"
```

---

## Task 2: チャンク本文を markdown 画像にする

**Files:**
- Modify: `rag/app/chunking/chunker.py:81-105`（`emit_atomic`）
- Test: `rag/tests/test_chunker.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_chunker.py` の末尾に追記:

```python
def test_image_with_path_becomes_markdown_image():
    blocks = [
        title("図", 1),
        ParsedBlock(type="image", image_path="images/a.jpg", caption="冷却図", page=3),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 1
    c = chunks[0]
    assert c.block_type == "image"
    assert c.text == "![冷却図](images/a.jpg)"
    assert c.page_start == 3 and c.page_end == 3


def test_image_without_caption_has_empty_alt():
    blocks = [ParsedBlock(type="image", image_path="images/b.png", page=0)]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert chunks[0].text == "![](images/b.png)"


def test_image_without_path_falls_back_to_placeholder():
    blocks = [ParsedBlock(type="image", caption=None, page=0)]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert chunks[0].text == "[image]"
```

`test_chunker.py` 冒頭の import に `ParsedBlock` が含まれることを確認（既に `from app.parsing.types import ParsedBlock` がある）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_chunker.py -v`
Expected: FAIL（image チャンク text が `[image]` のままで markdown にならない）

- [ ] **Step 3: `emit_atomic` の image 分岐を実装**

`rag/app/chunking/chunker.py` の `emit_atomic` 内、payload を決める分岐（83-88 行）を置換:

```python
        if block.type == "table":
            payload = block.html or block.text
        elif block.type == "equation":
            payload = block.latex or block.text
        else:  # image
            if block.image_path:
                payload = f"![{block.caption or ''}]({block.image_path})"
            else:
                payload = block.caption or block.text or "[image]"
```

（その下の `if block.caption and block.type != "image":` 以降は変更不要。image はキャプションを alt に含めるため caption を前置しない。）

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_chunker.py -v`
Expected: PASS（既存＋新規 3 件）

- [ ] **Step 5: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add rag/app/chunking/chunker.py rag/tests/test_chunker.py
git commit -m "feat: 画像チャンク本文を markdown 画像として生成する"
```

---

## Task 3: アセットパスの純関数（保存先導出・トラバーサル防御）

**Files:**
- Modify: `rag/app/documents_service.py`
- Test: 新規 `rag/tests/test_assets_path.py`

- [ ] **Step 1: 失敗するテストを書く**

新規 `rag/tests/test_assets_path.py`:

```python
from pathlib import Path

from app.documents_service import assets_dir_for, resolve_within


def test_assets_dir_for_strips_suffix_and_appends_assets():
    assert assets_dir_for("/data/uploads/abc_doc.pdf") == "/data/uploads/abc_doc_assets"


def test_resolve_within_allows_paths_under_base(tmp_path):
    base = tmp_path / "doc_assets"
    (base / "images").mkdir(parents=True)
    f = base / "images" / "x.png"
    f.write_bytes(b"x")
    got = resolve_within(str(base), "images/x.png")
    assert got == f.resolve()


def test_resolve_within_rejects_parent_traversal(tmp_path):
    base = tmp_path / "doc_assets"
    base.mkdir()
    (tmp_path / "secret.txt").write_text("nope")
    assert resolve_within(str(base), "../secret.txt") is None


def test_resolve_within_rejects_absolute_escape(tmp_path):
    base = tmp_path / "doc_assets"
    base.mkdir()
    assert resolve_within(str(base), "/etc/passwd") is None
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_assets_path.py -v`
Expected: FAIL（`ImportError`: `assets_dir_for` / `resolve_within` が無い）

- [ ] **Step 3: 純関数を実装**

`rag/app/documents_service.py` の先頭に import を追加し、末尾に 2 関数を追記:

```python
"""文書チャンクの選択ロジック（窓掛け・上限）。DB I/O は含まない純関数。"""

from pathlib import Path

MAX_CHUNKS = 40
WINDOW = 2


def select_chunks(chunks, *, around_ordinal, window=WINDOW, max_chunks=MAX_CHUNKS):
    """ordinal 昇順前提の chunks から、窓掛け（around 指定時）と上限を適用して返す。"""
    if around_ordinal is not None:
        lo, hi = around_ordinal - window, around_ordinal + window
        chunks = [c for c in chunks if lo <= c.ordinal <= hi]
    return chunks[:max_chunks]


def assets_dir_for(raw_path: str) -> str:
    """原本パスから、抽出画像を置く安定ディレクトリを決定的に導出する。"""
    return str(Path(raw_path).with_suffix("")) + "_assets"


def resolve_within(base: str, rel: str) -> Path | None:
    """base 配下に解決される実パスを返す。base の外へ出る場合は None（トラバーサル防御）。"""
    base_p = Path(base).resolve()
    target = (base_p / rel).resolve()
    try:
        target.relative_to(base_p)
    except ValueError:
        return None
    return target
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_assets_path.py -v`
Expected: PASS（4 件）

- [ ] **Step 5: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add rag/app/documents_service.py rag/tests/test_assets_path.py
git commit -m "feat: アセット保存先導出とパストラバーサル防御の純関数を追加"
```

---

## Task 4: worker で画像をコピーし索引から除外する

**Files:**
- Modify: `rag/app/worker.py:1-16`（import）, `:44-73`（parse 後〜upsert）
- Test: `rag/tests/test_worker_pipeline.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_worker_pipeline.py` を以下で置換（既存テストは残し、Recording 用埋め込みと新テストを追加）:

```python
import uuid
from pathlib import Path

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


class RecordingEmbedder(StubEmbedder):
    """embed に渡されたテキストを記録する StubEmbedder。"""
    def __init__(self, dim: int = 8):
        super().__init__(dim=dim)
        self.seen: list[str] = []

    def embed(self, texts):
        self.seen = list(texts)
        return super().embed(texts)


def _cleanup(session, store, doc_id, job_id):
    store.drop()
    session.query(Chunk).filter_by(document_id=doc_id).delete()
    session.query(IngestJob).filter_by(id=job_id).delete()
    session.query(Document).filter_by(id=doc_id).delete()
    session.commit()
    session.close()


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

    _cleanup(session, store, doc.id, job.id)


def test_run_ingest_copies_assets_and_excludes_image_chunks(tmp_path):
    # MinerU 出力相当の images ディレクトリを用意
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
    doc = Document(owner_user_id="u1", filename="doc.pdf", mime="application/pdf",
                   size=8, raw_path=str(raw), status="queued")
    session.add(doc)
    session.flush()
    job = IngestJob(document_id=doc.id, owner_user_id="u1", status="queued")
    session.add(job)
    session.commit()

    emb = RecordingEmbedder(dim=8)
    coll = "test_ingest_img_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    run_ingest(session, store, emb, parse_with_image, doc.id, job.id)

    chunks = session.query(Chunk).filter_by(document_id=doc.id).all()
    types = {c.block_type for c in chunks}
    assert "image" in types  # 画像チャンクは PG に残る
    n_index = sum(1 for c in chunks if c.block_type != "image")
    assert store.count() == n_index  # 索引は非画像チャンクのみ
    assert all("![" not in t for t in emb.seen)  # 埋め込みに画像 markdown は無い
    # 画像が安定ディレクトリへコピーされている
    copied = Path(str(raw.with_suffix("")) + "_assets") / "images" / "a.png"
    assert copied.is_file()

    _cleanup(session, store, doc.id, job.id)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_worker_pipeline.py -v`
Expected: FAIL（`test_run_ingest_copies_assets_and_excludes_image_chunks` が失敗。画像がコピーされず・画像チャンクも索引される）

- [ ] **Step 3: worker に import を追加**

`rag/app/worker.py` の冒頭 import 群（1-2 行）を置換:

```python
import asyncio
import shutil
from pathlib import Path
from typing import Callable
```

`from app.documents_service import` は無いので、`from app.db import SessionLocal` の下に追記:

```python
from app.documents_service import assets_dir_for
```

- [ ] **Step 4: アセットコピー用ヘルパーを追加**

`rag/app/worker.py` の `_set(...)` 関数定義の直後に追記:

```python
def _copy_assets(parsed: ParsedDocument, raw_path: str) -> None:
    """MinerU が出力した images/ を、文書ごとの安定ディレクトリへ複製する。
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
```

- [ ] **Step 5: parse 後にコピー、index 対象から画像を除外**

`rag/app/worker.py` の `run_ingest` 内、parse〜upsert（44-73 行）を置換:

```python
        _set(job, doc, session, status="parsing", progress=10, detail="MinerU 解析中")
        out_dir = str(Path(doc.raw_path).with_suffix("")) + "_mineru"
        parsed = parse_fn(doc.raw_path, out_dir)
        doc.page_count = parsed.page_count
        _copy_assets(parsed, doc.raw_path)

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

        # 画像チャンクは表示専用: PG には残すが埋め込み・Qdrant 索引からは除外する。
        index_rows = [(row, ch) for row, ch in rows if ch.block_type != "image"]

        _set(job, doc, session, status="embedding", progress=70, detail="埋め込み生成")
        texts = [f"{ch.heading_path}\n\n{ch.text}".strip() for _, ch in index_rows]
        vectors = embedder.embed(texts) if texts else []

        _set(job, doc, session, status="indexing", progress=90, detail="索引化")
        store.upsert([
            {
                "chunk_id": row.id, "document_id": doc.id, "owner_user_id": doc.owner_user_id,
                "heading_path": ch.heading_path, "page_start": ch.page_start, "page_end": ch.page_end,
                "block_type": ch.block_type, "source_type": "doc", "text": ch.text,
                "vector": vectors[i],
            }
            for i, (row, ch) in enumerate(index_rows)
        ])
```

- [ ] **Step 6: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_worker_pipeline.py -v`
Expected: PASS（2 件）

- [ ] **Step 7: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add rag/app/worker.py rag/tests/test_worker_pipeline.py
git commit -m "feat: 抽出画像を安定ディレクトリへ複製し画像チャンクを索引から除外する"
```

---

## Task 5: rag に画像配信エンドポイントを追加する

**Files:**
- Modify: `rag/app/routers/documents.py:1-6`（import）, 末尾にルート追加
- Test: 新規 `rag/tests/test_assets_api.py`

- [ ] **Step 1: 失敗するテストを書く**

新規 `rag/tests/test_assets_api.py`:

```python
from app.config import settings
from app.documents_service import assets_dir_for
from app.routers import documents as documents_router

TOKEN_HEADER = {"x-internal-token": settings.rag_internal_token}


def _patch_doc(monkeypatch, owner: str, raw_path: str):
    class _Doc:
        owner_user_id = owner
        mime = "application/pdf"
        filename = "doc.pdf"

    _Doc.raw_path = raw_path

    class _Session:
        def get(self, model, _id):
            return _Doc()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())


def test_assets_requires_token(client):
    res = client.get("/documents/d1/assets/images/x.png")
    assert res.status_code == 401


def test_assets_returns_file(client, monkeypatch, tmp_path):
    raw = tmp_path / "doc.pdf"
    base = tmp_path / "doc_assets" / "images"
    base.mkdir(parents=True)
    (base / "x.png").write_bytes(b"\x89PNG\r\n")
    assert assets_dir_for(str(raw)) == str(tmp_path / "doc_assets")
    _patch_doc(monkeypatch, owner="u1", raw_path=str(raw))

    res = client.get("/documents/d1/assets/images/x.png?owner_user_id=u1",
                     headers=TOKEN_HEADER)
    assert res.status_code == 200
    assert res.content.startswith(b"\x89PNG")


def test_assets_404_when_not_owner(client, monkeypatch, tmp_path):
    _patch_doc(monkeypatch, owner="owner-A", raw_path=str(tmp_path / "doc.pdf"))
    res = client.get("/documents/d1/assets/images/x.png?owner_user_id=intruder-B",
                     headers=TOKEN_HEADER)
    assert res.status_code == 404


def test_assets_404_when_missing_file(client, monkeypatch, tmp_path):
    _patch_doc(monkeypatch, owner="u1", raw_path=str(tmp_path / "doc.pdf"))
    res = client.get("/documents/d1/assets/images/nope.png?owner_user_id=u1",
                     headers=TOKEN_HEADER)
    assert res.status_code == 404
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_assets_api.py -v`
Expected: FAIL（ルート未定義で 401 以外は 404/405 等）

- [ ] **Step 3: import を追加**

`rag/app/routers/documents.py` の既存行 `from app.documents_service import select_chunks` を、純関数 2 つを足した次の 1 行に置換する（トラバーサル防御は `resolve_within` が担うため `os` 等の追加は不要）:

```python
from app.documents_service import assets_dir_for, resolve_within, select_chunks
```

- [ ] **Step 4: 配信ルートを追加**

`rag/app/routers/documents.py` の末尾（`get_document_raw` の後）に追記:

```python
@router.get("/documents/{document_id}/assets/{asset_path:path}",
            dependencies=[Depends(require_internal_token)])
def get_document_asset(document_id: str, asset_path: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = doc.raw_path
    finally:
        session.close()
    target = resolve_within(assets_dir_for(raw_path), asset_path)
    if target is None or not target.is_file():
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(str(target))
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest tests/test_assets_api.py tests/test_documents_api.py -v`
Expected: PASS（新規 4 件＋既存 documents_api が全件）

- [ ] **Step 6: rag 全体のテストを通す**

Run: `cd /Users/ansen/Documents/playground/a-rag/rag && uv run pytest -q`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add rag/app/routers/documents.py rag/tests/test_assets_api.py
git commit -m "feat: 文書アセット(画像)配信エンドポイントを追加"
```

---

## Task 6: 画像 URL を絶対 API パスへ書き換える純関数

**Files:**
- Create: `src/lib/agent/image-urls.ts`
- Test: 新規 `src/lib/agent/image-urls.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

新規 `src/lib/agent/image-urls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveImageUrls } from "@/lib/agent/image-urls";

describe("resolveImageUrls", () => {
  const doc = "doc-123";

  it("相対 images/ パスを絶対 API パスに書き換える", () => {
    expect(resolveImageUrls("![図1](images/a.jpg)", doc)).toBe(
      "![図1](/api/documents/doc-123/assets/images/a.jpg)",
    );
  });

  it("alt が空でも書き換える", () => {
    expect(resolveImageUrls("![](images/b.png)", doc)).toBe(
      "![](/api/documents/doc-123/assets/images/b.png)",
    );
  });

  it("1 つの本文中の複数画像を書き換える", () => {
    const out = resolveImageUrls("前 ![](images/a.jpg) 中 ![x](images/b.png) 後", doc);
    expect(out).toBe(
      "前 ![](/api/documents/doc-123/assets/images/a.jpg) 中 ![x](/api/documents/doc-123/assets/images/b.png) 後",
    );
  });

  it("images/ 以外のリンクや通常テキストは変更しない", () => {
    expect(resolveImageUrls("通常テキスト [link](https://x/y)", doc)).toBe(
      "通常テキスト [link](https://x/y)",
    );
  });

  it("既に絶対 URL の画像は二重変換しない", () => {
    const already = "![](https://cdn/x.jpg)";
    expect(resolveImageUrls(already, doc)).toBe(already);
  });

  it("表 HTML と混在しても表を壊さない", () => {
    const body = "<table><tr><td>A</td></tr></table>\n![](images/c.jpg)";
    expect(resolveImageUrls(body, doc)).toBe(
      "<table><tr><td>A</td></tr></table>\n![](/api/documents/doc-123/assets/images/c.jpg)",
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run --project unit src/lib/agent/image-urls.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 純関数を実装**

新規 `src/lib/agent/image-urls.ts`:

```ts
/** チャンク本文中の相対 markdown 画像 `![](images/...)` を、絶対 API パスへ書き換える。
 *  URL の真実をこの一箇所に集約する（ライブ・再読込・DB 永続化のいずれもこの結果を使う）。
 *  images/ 以外のリンクや既に絶対な URL は変更しない。 */
const REL_IMAGE_RE = /!\[([^\]]*)\]\((images\/[^)\s]+)\)/g;

export function resolveImageUrls(text: string, documentId: string): string {
  return text.replace(
    REL_IMAGE_RE,
    (_m, alt: string, rel: string) =>
      `![${alt}](/api/documents/${encodeURIComponent(documentId)}/assets/${rel})`,
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run --project unit src/lib/agent/image-urls.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add src/lib/agent/image-urls.ts src/lib/agent/image-urls.test.ts
git commit -m "feat: 画像URLを絶対APIパスへ書き換える純関数を追加"
```

---

## Task 7: tools.ts の snippet 生成に書き換えを適用する

**Files:**
- Modify: `src/lib/agent/tools.ts`（先頭 import, `:111-118`, `:143-147`）

このタスクはエージェント実行経路の結線で、ユニットテストは Task 6 の純関数でカバー済み。`tools.ts` には既存ユニットテスト（`tools.test.ts`）があり、回帰が無いことを確認する。

- [ ] **Step 1: import を追加**

`src/lib/agent/tools.ts` の import 群（3 行目付近、`retrieve-client` の import 付近）に追記:

```ts
import { resolveImageUrls } from "@/lib/agent/image-urls";
```

- [ ] **Step 2: retrieve の snippet（116 行付近）を書き換え適用に変更**

`registry.register({ ... })` 内の snippet 行を置換:

変更前:
```ts
            snippet: c.blockType === "table" ? c.text : (c.expandedText || c.text),
```
変更後:
```ts
            snippet: resolveImageUrls(
              c.blockType === "table" ? c.text : (c.expandedText || c.text),
              c.documentId,
            ),
```

- [ ] **Step 3: fetch_document の snippet（145 行付近）を書き換え適用に変更**

変更前:
```ts
            headingPath: c.headingPath, snippet: c.text,
```
変更後:
```ts
            headingPath: c.headingPath, snippet: resolveImageUrls(c.text, doc.documentId),
```

- [ ] **Step 4: 既存テストで回帰が無いことを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run --project unit src/lib/agent/tools.test.ts`
Expected: PASS（既存件数のまま）

- [ ] **Step 5: 型チェック**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec tsc --noEmit`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add src/lib/agent/tools.ts
git commit -m "feat: snippet生成時に画像URLを絶対APIパスへ書き換える"
```

---

## Task 8: Next.js に画像プロキシルートを追加する

**Files:**
- Create: `src/app/api/documents/[id]/assets/[...path]/route.ts`

raw ルート（`src/app/api/documents/[id]/raw/route.ts`）と同じ認証・プロキシ構造。raw ルート同様、Next 側のユニットテストは設けず手動確認とする（既存 raw ルートにもテストは無い）。

- [ ] **Step 1: ルートを実装**

新規 `src/app/api/documents/[id]/assets/[...path]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; path: string[] }> },
) {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, path } = await ctx.params;
  const rel = path.map(encodeURIComponent).join("/");
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}/assets/${rel}?owner_user_id=${encodeURIComponent(claims.sub)}`,
  );
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") || "application/octet-stream");
  const len = res.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("cache-control", "private, max-age=3600");
  return new NextResponse(res.body, { status: 200, headers });
}
```

- [ ] **Step 2: 型チェック**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec tsc --noEmit`
Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add "src/app/api/documents/[id]/assets/[...path]/route.ts"
git commit -m "feat: 画像アセットをragへプロキシするNextルートを追加"
```

---

## Task 9: 本文パーサ（テキスト/表/画像の分割）

**Files:**
- Create: `src/components/sources/parse-section-body.ts`
- Test: 新規 `src/components/sources/parse-section-body.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

新規 `src/components/sources/parse-section-body.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSectionBody } from "@/components/sources/parse-section-body";

describe("parseSectionBody", () => {
  it("プレーンテキストは 1 つの text セグメント", () => {
    expect(parseSectionBody("ただの本文")).toEqual([{ kind: "text", text: "ただの本文" }]);
  });

  it("空文字は空配列", () => {
    expect(parseSectionBody("   ")).toEqual([]);
  });

  it("表のみ", () => {
    const html = "<table><tr><td>A</td></tr></table>";
    expect(parseSectionBody(html)).toEqual([{ kind: "table", html }]);
  });

  it("画像のみ（src と alt を取り出す）", () => {
    expect(parseSectionBody("![冷却図](/api/documents/d/assets/images/a.jpg)")).toEqual([
      { kind: "image", alt: "冷却図", src: "/api/documents/d/assets/images/a.jpg" },
    ]);
  });

  it("テキスト→画像→テキストの順序を保つ", () => {
    const segs = parseSectionBody("前\n![](/x/a.jpg)\n後");
    expect(segs).toEqual([
      { kind: "text", text: "前" },
      { kind: "image", alt: "", src: "/x/a.jpg" },
      { kind: "text", text: "後" },
    ]);
  });

  it("テキストと表の混在", () => {
    const segs = parseSectionBody("見出し\n<table><tr><td>A</td></tr></table>");
    expect(segs).toEqual([
      { kind: "text", text: "見出し" },
      { kind: "table", html: "<table><tr><td>A</td></tr></table>" },
    ]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run --project unit src/components/sources/parse-section-body.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: パーサを実装**

新規 `src/components/sources/parse-section-body.ts`:

```ts
/** セクション本文を順序付きセグメントへ分割する。
 *  本文は素のテキスト・HTML 表・markdown 画像の混在を取りうる。
 *  画像の src は tools.ts で絶対 API パスへ解決済み。 */
export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "table"; html: string }
  | { kind: "image"; src: string; alt: string };

// <table>…</table> ブロック、または markdown 画像 ![alt](src) のいずれかにマッチ。
const SEG_RE = /<table[\s\S]*?<\/table>|!\[([^\]]*)\]\(([^)\s]+)\)/gi;

export function parseSectionBody(body: string): BodySegment[] {
  const segs: BodySegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (raw: string) => {
    const text = raw.trim();
    if (text) segs.push({ kind: "text", text });
  };
  SEG_RE.lastIndex = 0;
  while ((m = SEG_RE.exec(body)) !== null) {
    pushText(body.slice(last, m.index));
    if (m[0][0] === "<") {
      segs.push({ kind: "table", html: m[0] });
    } else {
      segs.push({ kind: "image", alt: m[1] ?? "", src: m[2] ?? "" });
    }
    last = m.index + m[0].length;
  }
  pushText(body.slice(last));
  return segs;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec vitest run --project unit src/components/sources/parse-section-body.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add src/components/sources/parse-section-body.ts src/components/sources/parse-section-body.test.ts
git commit -m "feat: 本文をテキスト/表/画像セグメントに分割するパーサを追加"
```

---

## Task 10: SectionBody で画像を描画する

**Files:**
- Modify: `src/components/sources/right-panel.tsx:1-7`（import）, `:58-76`（`SectionBody`）
- Modify: `src/components/sources/right-panel.stories.tsx`（ストーリー追加）

- [ ] **Step 1: import を追加**

`src/components/sources/right-panel.tsx` の import 群に追記（`HtmlTable` の import 付近）:

```ts
import { parseSectionBody } from "@/components/sources/parse-section-body";
```

（`useState` は 3 行目で既に import 済み。）

- [ ] **Step 2: `SectionBody` をセグメントベースに置換し `SectionImage` を追加**

`src/components/sources/right-panel.tsx` の `SectionBody`（58-76 行）を以下で置換:

```tsx
/**
 * セクション本文を描画する。本文は素のテキスト・HTMLテーブル・markdown 画像の混在を
 * 取りうる（expandedText 由来で見出し＋表が連結される等）。parseSectionBody で
 * 順序付きセグメントへ分割し、種類ごとに描画する。
 */
function SectionImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="rounded-[8px] border-[0.5px] border-divider bg-surface-2 px-3 py-4 text-center text-[11.5px] text-muted">
        画像を読み込めませんでした{alt ? `（${alt}）` : ""}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 認証付き動的アセットのため next/image は使わない
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="my-1 max-w-full rounded-[8px] border-[0.5px] border-divider"
    />
  );
}

function SectionBody({ body }: { body: string }) {
  const segs = parseSectionBody(body);
  if (segs.length === 0) return <div className={proseCls}>{body}</div>;
  if (segs.length === 1 && segs[0].kind === "text") {
    return <div className={proseCls}>{segs[0].text}</div>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {segs.map((s, i) => {
        if (s.kind === "table") return <HtmlTable key={i} html={s.html} className="my-1" />;
        if (s.kind === "image") return <SectionImage key={i} src={s.src} alt={s.alt} />;
        return <div key={i} className={proseCls}>{s.text}</div>;
      })}
    </div>
  );
}
```

- [ ] **Step 3: 画像入りストーリーを追加**

`src/components/sources/right-panel.stories.tsx` の末尾に追記（データ URI を使い、ネットワーク無しで実描画される 1x1 PNG）:

```tsx
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** 一次資料に markdown 画像が含まれるケース（実画像が描画される）。 */
export const WithImage: Story = {
  args: {
    sources: [
      {
        id: "img-doc",
        type: "doc",
        title: "05-image-grounding-cooling-line.pdf",
        path: "05-image-grounding-cooling-line.pdf",
        author: "",
        date: "",
        sections: [
          {
            id: "sec-img",
            heading: "冷却ライン CL-2 異常報告",
            body: `T2 と F1 の同時異常を一次対応する。\n![冷却ライン図](${TINY_PNG})\n一次対応 V-12 が固着している場合は交換する。`,
            highlight: true,
            blockType: "image",
            page: 0,
          },
        ],
      },
    ],
    activeSourceId: "img-doc",
    highlightSectionId: "sec-img",
  },
};
```

- [ ] **Step 4: ユニット＋型チェック**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm exec tsc --noEmit && pnpm test`
Expected: 型エラー無し・unit 全 PASS

- [ ] **Step 5: Storybook テスト（描画スモーク）**

Run: `cd /Users/ansen/Documents/playground/a-rag && pnpm test:storybook`
Expected: 全ストーリーがクラッシュせずマウントされ PASS（`WithImage` 含む）

- [ ] **Step 6: コミット**

```bash
cd /Users/ansen/Documents/playground/a-rag
git add src/components/sources/right-panel.tsx src/components/sources/right-panel.stories.tsx
git commit -m "feat: 一次資料パネルでmarkdown画像を実画像として描画する"
```

---

## Task 11: 統合確認（rag 再ビルド＋再索引＋目視）

**Files:** なし（実環境での検証）

- [ ] **Step 1: rag を再ビルドして再起動**

```bash
cd /Users/ansen/Documents/playground/a-rag
docker compose up -d --build rag rag-worker
```
Expected: `rag` が healthy になる（`docker compose ps`）。

- [ ] **Step 2: 画像付き PDF を再索引**

ブラウザ（ローカル起動 `pnpm dev`）から `docs/demo-files/05-image-grounding-cooling-line.pdf` を再アップロードし、索引完了（ready）まで待つ。
Expected: アップロード一覧で status=ready。

- [ ] **Step 3: 画像表示を目視確認**

「T2 温度上昇と F1 流量低下が同時に出た場合…」の質問を投げ、一次資料パネルを開く。
Expected: 以前 `[image]` だった箇所に実画像が表示される。読み込み失敗時は「画像を読み込めませんでした」フォールバックが出る。

- [ ] **Step 4: スレッド再読込でも表示されることを確認**

ページをリロードして同スレッドを開き直し、一次資料パネルで画像が依然表示されることを確認（永続化された snippet が絶対 URL を保持している）。
Expected: 画像が表示される。

---

## Self-Review メモ

- **Spec カバレッジ**: 変更点 1〜8（spec）→ Task 1（types/mineru）, 2（chunker）, 3-4（worker＋純関数）, 5（rag 配信）, 6-7（resolveImageUrls＋tools 結線）, 8（Next プロキシ）, 9-10（パーサ＋SectionBody）。テスト項目（chunker/worker/resolveImageUrls/assets/SectionBody）すべてに対応タスクあり。DB マイグレーション無し・決定的保存先・tools.ts 集約の 3 方針を順守。
- **型整合**: `assets_dir_for`/`resolve_within`（Task 3）を worker（Task 4）と router（Task 5）が同名で使用。`resolveImageUrls`（Task 6）を tools.ts（Task 7）が使用。`parseSectionBody`/`BodySegment`（Task 9）を right-panel（Task 10）が使用。`ParsedDocument.images_dir`（Task 1）を worker（Task 4）が参照。命名一致を確認済み。
- **プレースホルダ**: 各コード手順に実コードを記載。TBD/TODO 無し。
