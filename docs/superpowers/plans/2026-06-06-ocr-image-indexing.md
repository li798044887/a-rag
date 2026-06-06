# OCR 图片索引 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 MinerU 提取的图片执行 PaddleOCR，将识别文字作为 image_ocr chunk 参与向量索引，使图片中的文字可被检索。

**Architecture:** 新增 `ocr.py` 模块封装 PaddleOCR；`ParsedBlock` 增加 `ocr_text` 字段；`chunker.py` 的 `emit_atomic` 为有 OCR 文字的 image block 额外生成 `block_type="image_ocr"` 的 chunk；`worker.py` 在 `copy_assets` 后调用 OCR。`worker.py:87` 的过滤逻辑无需改动。

**Tech Stack:** Python 3.11, PaddleOCR, PaddlePaddle (CPU)

---

### Task 1: ParsedBlock に ocr_text フィールドを追加

**Files:**
- Modify: `rag/app/parsing/types.py`

- [ ] **Step 1: ocr_text フィールドを追加**

```python
@dataclass
class ParsedBlock:
    """MinerU 出力を正規化した 1 ブロック。"""
    type: str  # "title" | "text" | "table" | "equation" | "image"
    text: str = ""
    level: int | None = None
    page: int = 0
    html: str | None = None
    latex: str | None = None
    caption: str | None = None
    image_path: str | None = None
    ocr_text: str | None = None  # OCR による画像内文字認識結果
```

- [ ] **Step 2: 既存テストが通ることを確認**

```bash
cd rag && uv run pytest tests/test_mineru_normalize.py tests/test_chunker.py tests/test_worker_pipeline.py -v --noconftest
```

Expected: 全 PASS（ocr_text=None がデフォルトなので既存コードは影響を受けない）

- [ ] **Step 3: Commit**

```bash
git add rag/app/parsing/types.py
git commit -m "feat: ParsedBlock に ocr_text フィールドを追加"
```

---

### Task 2: OCR 設定を config.py に追加

**Files:**
- Modify: `rag/app/config.py`

- [ ] **Step 1: ocr_lang を追加**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://arag:arag@localhost:5432/arag"
    qdrant_url: str = "http://localhost:6333"
    redis_url: str = "redis://localhost:6379"
    device: str = "cpu"
    embedder: str = "bge-m3"
    reranker: str = "bge"
    rag_internal_token: str = "dev-internal-token"
    upload_dir: str = "/data/uploads"
    ocr_lang: str = "ch"
```

- [ ] **Step 2: Commit**

```bash
git add rag/app/config.py
git commit -m "feat: OCR 言語設定 ocr_lang を追加"
```

---

### Task 3: OCR モジュールを作成

**Files:**
- Create: `rag/app/parsing/ocr.py`
- Create: `rag/tests/test_ocr.py`

- [ ] **Step 1: 失敗するテストを書く**

```python
# tests/test_ocr.py
from unittest.mock import MagicMock, patch

from app.parsing.types import ParsedBlock
from app.parsing.ocr import ocr_images


def test_ocr_images_skips_non_image_blocks():
    blocks = [
        ParsedBlock(type="title", text="章", level=1, page=0),
        ParsedBlock(type="text", text="本文です。", page=0),
    ]
    result = ocr_images(blocks, images_dir="/fake/images")
    assert result == blocks  # 変更なし


def test_ocr_images_writes_ocr_text_on_image_blocks(tmp_path):
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    img_path = img_dir / "a.png"
    img_path.write_bytes(b"\x89PNG\r\n")

    blocks = [
        ParsedBlock(type="image", image_path="images/a.png", caption="図1", page=0),
    ]

    mock_ocr = MagicMock()
    mock_ocr.ocr.return_value = [[[[0,0],[100,0],[100,50],[0,50]], ("認識結果", 0.95)]]  # noqa: E501

    result = ocr_images(blocks, images_dir=str(tmp_path), ocr=mock_ocr)

    assert result[0].ocr_text == "認識結果"
    mock_ocr.ocr.assert_called_once_with(str(img_path))


def test_ocr_images_handles_missing_image_file(tmp_path):
    blocks = [
        ParsedBlock(type="image", image_path="images/nonexistent.png", page=0),
    ]

    mock_ocr = MagicMock()
    mock_ocr.ocr.side_effect = FileNotFoundError("no such file")

    result = ocr_images(blocks, images_dir=str(tmp_path), ocr=mock_ocr)

    assert result[0].ocr_text is None  # エラーでもクラッシュしない


def test_ocr_images_handles_empty_ocr_result(tmp_path):
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    (img_dir / "blank.png").write_bytes(b"\x89PNG\r\n")

    blocks = [
        ParsedBlock(type="image", image_path="images/blank.png", page=0),
    ]

    mock_ocr = MagicMock()
    mock_ocr.ocr.return_value = [None]  # 文字なし

    result = ocr_images(blocks, images_dir=str(tmp_path), ocr=mock_ocr)

    assert result[0].ocr_text is None


def test_ocr_images_no_image_blocks_does_nothing(tmp_path):
    blocks = [ParsedBlock(type="text", text="hello", page=0)]
    result = ocr_images(blocks, images_dir=str(tmp_path))
    assert result == blocks
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd rag && uv run pytest tests/test_ocr.py -v --noconftest
```

Expected: FAIL (ModuleNotFoundError: No module named 'app.parsing.ocr')

- [ ] **Step 3: OCR モジュールを実装**

```python
# app/parsing/ocr.py
import logging
from pathlib import Path

from app.parsing.types import ParsedBlock

logger = logging.getLogger(__name__)


def _build_ocr(lang: str):
    """PaddleOCR インスタンスを生成（遅延インポートで起動時ロードを回避）。"""
    from paddleocr import PaddleOCR
    return PaddleOCR(lang=lang)


def ocr_images(
    blocks: list[ParsedBlock],
    images_dir: str,
    ocr=None,
) -> list[ParsedBlock]:
    """image 型ブロックの画像に対し OCR を実行し ocr_text に書き込む。

    ocr が未指定の場合は PaddleOCR(lang="ch") を生成する。
    単一画像の OCR 失敗はログに残してスキップし、後続は続行する。
    """
    image_blocks = [b for b in blocks if b.type == "image" and b.image_path]
    if not image_blocks:
        return blocks

    if ocr is None:
        from app.config import settings
        ocr = _build_ocr(settings.ocr_lang)

    base = Path(images_dir)

    for b in image_blocks:
        img_path = base / b.image_path
        if not img_path.is_file():
            logger.warning("OCR: image file not found: %s", img_path)
            continue
        try:
            result = ocr.ocr(str(img_path))
            lines: list[str] = []
            if result and result[0]:
                for line in result[0]:
                    text = line[1][0]
                    if text.strip():
                        lines.append(text.strip())
            if lines:
                b.ocr_text = "\n".join(lines)
        except Exception:
            logger.warning("OCR failed for %s", img_path, exc_info=True)

    return blocks
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd rag && uv run pytest tests/test_ocr.py -v --noconftest
```

Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add rag/app/parsing/ocr.py rag/tests/test_ocr.py
git commit -m "feat: PaddleOCR による画像内文字認識モジュールを追加"
```

---

### Task 4: Chunker を image_ocr chunk 対応に更新

**Files:**
- Modify: `rag/app/chunking/chunker.py` (emit_atomic 関数)
- Modify: `rag/tests/test_chunker.py`

- [ ] **Step 1: 失敗するテストを追加**

```python
# test_chunker.py に追加

def test_image_with_ocr_emits_ocr_chunk():
    blocks = [
        title("図", 1),
        ParsedBlock(type="image", image_path="images/a.jpg",
                    caption="冷却図", page=3, ocr_text="図1: 冷却システム\n流入 出口"),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert len(chunks) == 2
    image_chunks = [c for c in chunks if c.block_type == "image"]
    ocr_chunks = [c for c in chunks if c.block_type == "image_ocr"]
    assert len(image_chunks) == 1
    assert len(ocr_chunks) == 1
    assert image_chunks[0].text == "![冷却図](images/a.jpg)"
    assert ocr_chunks[0].text == "図1: 冷却システム\n流入 出口"
    assert ocr_chunks[0].heading_path == "図"
    assert ocr_chunks[0].page_start == 3


def test_image_without_ocr_does_not_emit_ocr_chunk():
    blocks = [
        ParsedBlock(type="image", image_path="images/b.png", page=0, ocr_text=None),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    types = {c.block_type for c in chunks}
    assert "image_ocr" not in types
    assert len(chunks) == 1


def test_image_with_empty_ocr_text_does_not_emit_ocr_chunk():
    blocks = [
        ParsedBlock(type="image", image_path="images/c.png", page=0, ocr_text=""),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    types = {c.block_type for c in chunks}
    assert "image_ocr" not in types
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd rag && uv run pytest tests/test_chunker.py -v --noconftest -k "ocr"
```

Expected: FAIL (image_ocr chunk が生成されない)

- [ ] **Step 3: emit_atomic を修正**

`emit_atomic` 関数の末尾（`chunks.append(...)` と `ordinal += 1` の後）に以下を追加：

```python
    def emit_atomic(block: ParsedBlock) -> None:
        nonlocal ordinal
        if block.type == "table":
            payload = block.html or block.text
        elif block.type == "equation":
            payload = block.latex or block.text
        else:  # image
            if block.image_path:
                payload = f"![{block.caption or ''}]({block.image_path})"
            else:
                payload = block.caption or block.text or "[image]"
        parts = []
        if block.caption and block.type != "image":
            parts.append(block.caption)
        parts.append(payload)
        body = "\n".join(parts).strip()
        if not body:
            return
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

        # 画像に OCR テキストがあれば image_ocr chunk も生成
        if block.type == "image" and block.ocr_text and block.ocr_text.strip():
            chunks.append(Chunk(
                ordinal=ordinal,
                heading_path=_heading_path(stack),
                page_start=block.page,
                page_end=block.page,
                block_type="image_ocr",
                text=block.ocr_text.strip(),
                token_len=estimate_tokens(block.ocr_text.strip()),
            ))
            ordinal += 1
```

- [ ] **Step 4: 全チャンクテストが通ることを確認**

```bash
cd rag && uv run pytest tests/test_chunker.py -v --noconftest
```

Expected: 全 PASS（新規 3 件 + 既存 10 件）

- [ ] **Step 5: Commit**

```bash
git add rag/app/chunking/chunker.py rag/tests/test_chunker.py
git commit -m "feat: image block の ocr_text から image_ocr chunk を生成"
```

---

### Task 5: Worker に OCR 呼び出しを組み込み

**Files:**
- Modify: `rag/app/worker.py`
- Modify: `rag/tests/test_worker_pipeline.py`

- [ ] **Step 1: 既存のワーカーテストに monkeypatch を追加**

`test_run_ingest_copies_assets_and_excludes_image_chunks` のシグネチャに `monkeypatch` を追加し、先頭に OCR no-op を仕込む：

```python
def test_run_ingest_copies_assets_and_excludes_image_chunks(tmp_path, monkeypatch):
    monkeypatch.setattr("app.worker.ocr_images", lambda blocks, images_dir: blocks)
    # ... 残りは変更なし ...
```

- [ ] **Step 2: 失敗する新規統合テストを追加**

```python
# test_worker_pipeline.py に追加

def test_run_ingest_indexes_image_ocr_chunks(tmp_path, monkeypatch):
    """image_ocr chunk は Qdrant に索引され、元の image chunk は除外されたまま。"""
    # PaddleOCR 非依存で通すため ocr_images を no-op に差し替え。
    # テスト用 parse_fn が ocr_text を直接注入するため、OCR ステップは不要。
    monkeypatch.setattr("app.worker.ocr_images", lambda blocks, images_dir: blocks)

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
                                caption="図", page=0,
                                ocr_text="画像内の文字列")],
            page_count=1, images_dir=str(mineru_dir),
        )

    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    content, _, job = _mk(session, owner, h, str(raw))

    emb = RecordingEmbedder(dim=8)
    coll = "test_ingest_ocr_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    run_ingest(session, store, emb, parse_with_image, h, job.id)

    chunks = session.query(Chunk).filter_by(content_hash=h).all()
    types = {c.block_type for c in chunks}
    assert "image" in types
    assert "image_ocr" in types

    # image_ocr chunk は embedding される
    assert any("画像内の文字列" in t for t in emb.seen)

    # image chunk の markdown は embedding されない
    assert not any("![" in t for t in emb.seen)

    # Qdrant には image_ocr のみ格納
    n_index = sum(1 for c in chunks if c.block_type != "image")
    assert store.count() == n_index

    _cleanup(session, store, h, owner)
```

- [ ] **Step 3: 新規テストが失敗することを確認**

```bash
cd rag && uv run pytest tests/test_worker_pipeline.py::test_run_ingest_indexes_image_ocr_chunks -v --noconftest
```

Expected: FAIL (ocr_text が使われていない、または ocr_images 未定義)

- [ ] **Step 4: worker.py に OCR 呼び出しを追加**

`run_ingest` 関数内、`_copy_assets` の後、`chunk_blocks` の前に OCR 呼び出しを挿入：

```python
from app.parsing.ocr import ocr_images

def run_ingest(session, store, embedder, parse_fn, content_hash, job_id):
    # ... (中略) ...
        _copy_assets(parsed, content.raw_path)

        # OCR: 画像内の文字を認識して ParsedBlock.ocr_text に書き込む
        parsed.blocks = ocr_images(parsed.blocks, images_dir=assets_dir_for(content.raw_path))

        _set(job, content, session, status="chunking", progress=40, detail="チャンク化")
        chunks = chunk_blocks(parsed.blocks)
    # ... (後略) ...
```

`assets_dir_for` は既に import 済み。

- [ ] **Step 5: 全ワーカーテストが通ることを確認**

```bash
cd rag && uv run pytest tests/test_worker_pipeline.py -v --noconftest
```

Expected: 全 4 PASS（既存 3 件 + 新規 1 件）

- [ ] **Step 6: Commit**

```bash
git add rag/app/worker.py rag/tests/test_worker_pipeline.py
git commit -m "feat: worker の ingest パイプラインに OCR ステップを追加"
```

---

### Task 6: 依存関係を更新

**Files:**
- Modify: `rag/pyproject.toml`
- Modify: `rag/Dockerfile`

- [ ] **Step 1: pyproject.toml に PaddleOCR 依存を追加**

```toml
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "pydantic-settings>=2.6",
  "sqlalchemy>=2.0",
  "psycopg[binary]>=3.2",
  "alembic>=1.13",
  "mineru[pipeline]",
  "FlagEmbedding>=1.3",
  "qdrant-client>=1.12",
  "arq>=0.26",
  "tenacity>=9.0",
  "paddlepaddle",
  "paddleocr",
]
```

- [ ] **Step 2: Dockerfile に PaddleOCR システム依存を追加**

`libreoffice-impress` の後、`fonts-noto-cjk` の前に以下を追加：

```dockerfile
        libgl1 libglib2.0-0 libxcb1 libsm6 libxext6 libxrender1 \
        libgomp1 \
```

（`libgomp1` は PaddlePaddle の実行時依存。実際には既存の `libgl1` 等と重複するが明示しておく）

- [ ] **Step 3: uv.lock を更新**

```bash
cd rag && uv lock
```

- [ ] **Step 4: 全テストが通ることを確認**

```bash
cd rag && uv run pytest tests/ -v --noconftest
```

Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add rag/pyproject.toml rag/uv.lock rag/Dockerfile
git commit -m "chore: PaddleOCR 依存を追加"
```

---

### Task 7: 最終確認

- [ ] **Step 1: 型チェック**

```bash
cd rag && uv run mypy app/ --ignore-missing-imports || echo "mypy not configured, skip"
```

- [ ] **Step 2: 全テスト最終実行**

```bash
cd rag && uv run pytest tests/ -v --noconftest
```

Expected: 全 PASS

- [ ] **Step 3: 変更差分の最終確認**

```bash
git diff --stat HEAD~6
```
