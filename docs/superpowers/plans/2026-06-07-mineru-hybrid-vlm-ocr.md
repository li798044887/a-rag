# MinerU hybrid(VLM) 移行と EasyOCR 廃止 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MinerU を構成駆動で `pipeline`(dev/CPU) と `hybrid-auto-engine`(prod/CUDA, VLM 図表解析) に切替え、図表テキスト認識を MinerU に一本化して EasyOCR を廃止する。

**Architecture:** 新設の `MINERU_BACKEND` 設定で `mineru` CLI の `-b` を切替。hybrid では `--image-analysis`(既定有効) が図表を解釈し、出力 `*_content_list.json` の caption/text として正規化される。dev は pipeline のまま vllm 不要。VLM モデル `opendatalab/MinerU2.5-Pro-2604-1.2B` は初回オンライン取得 → 以降 `HF_HUB_OFFLINE=1` でキャッシュ運用。

**Tech Stack:** Python / FastAPI / pydantic-settings / MinerU(pipeline,vlm) / vllm(GPU のみ) / pytest / Docker / docker-compose

参照スペック: `docs/superpowers/specs/2026-06-07-mineru-hybrid-vlm-ocr-design.md`

備考: rag のテストは共有 dev Postgres(5433) 前提のものがある（worker pipeline 系）。`pytest` 実行時は docker のフルスタックが必要。純ロジック系（config/mineru/chunker/dispatch）は DB 不要。

---

### Task 1: `parse_backend` 設定の追加

**Files:**
- Modify: `rag/app/config.py`
- Test: `rag/tests/test_config.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_config.py` を新規作成:

```python
import importlib

import pytest


def _fresh_settings(monkeypatch, **env):
    """env を差し替えて Settings を再評価して返す。"""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import app.config as config
    importlib.reload(config)
    return config


def test_parse_backend_defaults_to_pipeline(monkeypatch):
    monkeypatch.delenv("MINERU_BACKEND", raising=False)
    config = _fresh_settings(monkeypatch)
    assert config.settings.parse_backend == "pipeline"


def test_parse_backend_accepts_hybrid(monkeypatch):
    config = _fresh_settings(monkeypatch, MINERU_BACKEND="hybrid-auto-engine")
    assert config.settings.parse_backend == "hybrid-auto-engine"


def test_parse_backend_rejects_unknown(monkeypatch):
    monkeypatch.setenv("MINERU_BACKEND", "bogus-backend")
    import app.config as config
    with pytest.raises(ValueError, match="MINERU_BACKEND"):
        importlib.reload(config)


def teardown_module(module):
    # 他テストへ影響しないよう既定状態へ戻す。
    import app.config as config
    importlib.reload(config)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && uv run pytest tests/test_config.py -v`
Expected: FAIL（`parse_backend` 属性が無い / バリデーション未実装）

- [ ] **Step 3: 最小実装**

`rag/app/config.py` の `qdrant_collection` 行の直後に設定を追加:

```python
    # 空なら embedder からコレクション名を導出（バージョニング: モデル毎に別コレクション）。
    qdrant_collection: str = ""
    # MinerU パースバックエンド。dev/CPU は "pipeline"、prod/CUDA は "hybrid-auto-engine"。
    # hybrid/vlm は VLM(MinerU2.5) + vllm を要し GPU 前提。
    parse_backend: str = "pipeline"
```

そして validator を `_resolve_device` の下に追加:

```python
    @field_validator("parse_backend")
    @classmethod
    def _check_parse_backend(cls, v: str) -> str:
        """許容するバックエンドのみ通す。"""
        v = (v or "pipeline").strip()
        allowed = {"pipeline", "hybrid-auto-engine", "vlm-auto-engine"}
        if v not in allowed:
            raise ValueError(
                f"MINERU_BACKEND は {sorted(allowed)} のいずれか。受領: {v!r}"
            )
        return v
```

環境変数名を `MINERU_BACKEND` にするため、pydantic-settings の既定（フィールド名大文字＝`PARSE_BACKEND`）と異なる。エイリアスを付ける。フィールド定義を次に変更:

```python
    from pydantic import Field  # ファイル冒頭の import に追記
    ...
    parse_backend: str = Field(default="pipeline", validation_alias="MINERU_BACKEND")
```

最終的な import 行（ファイル先頭）:

```python
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_config.py -v`
Expected: PASS（3 テスト）

- [ ] **Step 5: コミット**

```bash
git add rag/app/config.py rag/tests/test_config.py
git commit -m "feat: MINERU_BACKEND 設定を追加しパースバックエンドを構成駆動化"
```

---

### Task 2: `mineru.parse` をバックエンド駆動にする

**Files:**
- Modify: `rag/app/parsing/mineru.py:55-63`
- Test: `rag/tests/test_mineru_backend.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_mineru_backend.py` を新規作成:

```python
import json

import app.parsing.mineru as mineru


def _write_content_list(out_dir, items):
    import pathlib
    p = pathlib.Path(out_dir) / "doc" / "auto"
    p.mkdir(parents=True, exist_ok=True)
    (p / "x_content_list.json").write_text(json.dumps(items), encoding="utf-8")


def test_parse_passes_configured_backend(tmp_path, monkeypatch):
    captured = {}

    def fake_run(cmd, check):
        captured["cmd"] = cmd
        _write_content_list(str(tmp_path / "out"),
                            [{"type": "text", "text": "本文", "page_idx": 0}])

    monkeypatch.setattr(mineru.subprocess, "run", fake_run)
    monkeypatch.setattr(mineru.settings, "parse_backend", "hybrid-auto-engine")
    monkeypatch.setattr(mineru.settings, "device", "cuda")

    doc = mineru.parse(str(tmp_path / "in.pdf"), str(tmp_path / "out"))

    assert "-b" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("-b") + 1] == "hybrid-auto-engine"
    assert "-d" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("-d") + 1] == "cuda"
    assert any(b.type == "text" and b.text == "本文" for b in doc.blocks)


def test_parse_defaults_to_pipeline_backend(tmp_path, monkeypatch):
    captured = {}

    def fake_run(cmd, check):
        captured["cmd"] = cmd
        _write_content_list(str(tmp_path / "out"),
                            [{"type": "text", "text": "x", "page_idx": 0}])

    monkeypatch.setattr(mineru.subprocess, "run", fake_run)
    monkeypatch.setattr(mineru.settings, "parse_backend", "pipeline")

    mineru.parse(str(tmp_path / "in.pdf"), str(tmp_path / "out"))
    assert captured["cmd"][captured["cmd"].index("-b") + 1] == "pipeline"
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && uv run pytest tests/test_mineru_backend.py -v`
Expected: FAIL（現状 `-b` はハードコード "pipeline"。hybrid 指定テストが失敗）

- [ ] **Step 3: 最小実装**

`rag/app/parsing/mineru.py` の `parse` 内 subprocess 呼び出しを変更:

```python
def parse(file_path: str, out_dir: str) -> ParsedDocument:
    """MinerU CLI を実行し content_list.json を正規化して返す。"""
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    # -b: settings.parse_backend で切替。
    #   pipeline … CPU/レイアウト解析のみ（dev 既定）。content_list.json を出力。
    #   hybrid-auto-engine … VLM + 構造解析（prod/CUDA）。--image-analysis(既定有効) で図表も解釈。
    subprocess.run(
        ["mineru", "-p", file_path, "-o", out_dir,
         "-d", settings.device, "-b", settings.parse_backend],
        check=True,
    )
    files = sorted(Path(out_dir).rglob("*_content_list.json"))
    if not files:
        raise FileNotFoundError(f"no *_content_list.json found under {out_dir}")
    content_list = files[-1]
    items = json.loads(content_list.read_text(encoding="utf-8"))
    blocks = [b for b in (_block_from_item(it) for it in items) if b is not None]
    page_count = max((b.page for b in blocks), default=0) + 1
    return ParsedDocument(blocks=blocks, page_count=page_count,
                          images_dir=str(content_list.parent))
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_mineru_backend.py tests/test_mineru_normalize.py -v`
Expected: PASS（backend 2 テスト + 既存 normalize テスト）

- [ ] **Step 5: コミット**

```bash
git add rag/app/parsing/mineru.py rag/tests/test_mineru_backend.py
git commit -m "feat: MinerU 解析バックエンドを settings.parse_backend で切替"
```

---

### Task 3: EasyOCR 経路の削除（コード本体）

**Files:**
- Delete: `rag/app/parsing/ocr.py`
- Modify: `rag/app/parsing/types.py:15`（`ocr_text` 削除）
- Modify: `rag/app/worker.py`（import と `ocr_images` 呼び出し削除）
- Modify: `rag/app/chunking/chunker.py:110-124`（`image_ocr` 生成削除）

- [ ] **Step 1: `chunker` から image_ocr 生成を削除**

`rag/app/chunking/chunker.py` の `emit_atomic` 末尾、`ordinal += 1`（108 行目）の直後にある以下のブロックを**削除**:

```python
        # 画像に OCR テキストがあれば image_ocr chunk も生成
        if block.type == "image" and block.ocr_text and block.ocr_text.strip():
            body = block.ocr_text.strip()
            if block.image_path:
                body = f"[image: {block.image_path}]\n{body}"
            chunks.append(Chunk(
                ordinal=ordinal,
                heading_path=_heading_path(stack),
                page_start=block.page,
                page_end=block.page,
                block_type="image_ocr",
                text=body,
                token_len=estimate_tokens(body),
            ))
            ordinal += 1
```

- [ ] **Step 2: `types.py` から `ocr_text` を削除**

`rag/app/parsing/types.py` の `ParsedBlock` から次の行を削除:

```python
    ocr_text: str | None = None  # OCR による画像内文字認識結果
```

- [ ] **Step 3: `worker.py` から OCR 呼び出しと import を削除**

`rag/app/worker.py` 冒頭の import 行を削除:

```python
from app.parsing.ocr import ocr_images
```

`run_ingest` 内（`_copy_assets` の直後）の以下 2 行を削除:

```python
        # OCR: 画像内の文字を認識して ParsedBlock.ocr_text に書き込む
        parsed.blocks = ocr_images(parsed.blocks, images_dir=assets_dir_for(content.raw_path))
```

`assets_dir_for` は他でも使用しているため import はそのまま残す（`_copy_assets` 等で利用）。削除後に未使用 import が無いか確認する。

- [ ] **Step 4: `ocr.py` を削除**

```bash
git rm rag/app/parsing/ocr.py
```

- [ ] **Step 5: 静的確認（未使用参照が無いこと）**

Run: `cd rag && grep -rn "ocr_text\|ocr_images\|parsing.ocr\|image_ocr" app/`
Expected: 出力なし（空）

- [ ] **Step 6: コミット**

```bash
git add rag/app/parsing/types.py rag/app/worker.py rag/app/chunking/chunker.py
git commit -m "refactor: EasyOCR 経路(ocr_images/ocr_text/image_ocr chunk)を削除"
```

---

### Task 4: テストの更新（EasyOCR/image_ocr 依存の除去）

**Files:**
- Delete: `rag/tests/test_ocr.py`
- Modify: `rag/tests/test_chunker.py`（image_ocr 系 3 テストを差し替え）
- Modify: `rag/tests/test_worker_pipeline.py`（ocr_images monkeypatch と image_ocr テストを除去）

- [ ] **Step 1: `test_ocr.py` を削除**

```bash
git rm rag/tests/test_ocr.py
```

- [ ] **Step 2: `test_chunker.py` の image_ocr 系テストを置換**

`rag/tests/test_chunker.py` の以下 3 テストを**削除**:
`test_image_with_ocr_emits_ocr_chunk` / `test_image_without_ocr_does_not_emit_ocr_chunk` / `test_image_with_empty_ocr_text_does_not_emit_ocr_chunk`

代わりに次の 2 テストを追加（hybrid では図表テキストが caption または独立 text ブロックで入る前提を検証）:

```python
def test_image_block_emits_single_image_chunk_with_caption():
    blocks = [
        title("図", 1),
        ParsedBlock(type="image", image_path="images/a.jpg", caption="冷却図", page=3),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    image_chunks = [c for c in chunks if c.block_type == "image"]
    assert len(image_chunks) == 1
    assert image_chunks[0].text == "![冷却図](images/a.jpg)"
    # image_ocr 型は廃止済み。
    assert all(c.block_type != "image_ocr" for c in chunks)


def test_figure_text_as_text_block_is_chunked_as_text():
    # hybrid の図表解析がテキストを独立 text ブロックで返すケース。
    blocks = [
        title("図", 1),
        ParsedBlock(type="image", image_path="images/a.jpg", caption="図1", page=0),
        ParsedBlock(type="text", text="図1: 冷却システム 流入 出口", page=0),
    ]
    chunks = chunk_blocks(blocks, target_tokens=1000)
    assert any(c.block_type == "text" and "冷却システム" in c.text for c in chunks)
    assert all(c.block_type != "image_ocr" for c in chunks)
```

注: `title` ヘルパと `ParsedBlock` は既存テストの import を流用（ファイル冒頭で既に import 済み）。

- [ ] **Step 3: `test_worker_pipeline.py` の OCR 依存を除去**

`test_run_ingest_copies_assets_and_excludes_image_chunks` から次の行を削除:

```python
    monkeypatch.setattr("app.worker.ocr_images", lambda blocks, images_dir: blocks)
```

`test_run_ingest_indexes_image_ocr_chunks` テスト関数を**まるごと削除**（image_ocr 概念が廃止のため）。

- [ ] **Step 4: 純ロジックテストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_chunker.py tests/test_parse_dispatch.py -v`
Expected: PASS（image_ocr 参照が消え、新規 2 テストが緑）

- [ ] **Step 5: 静的確認**

Run: `cd rag && grep -rn "ocr_images\|image_ocr\|ocr_text\|EASYOCR" tests/`
Expected: 出力なし（空）

- [ ] **Step 6: コミット**

```bash
git add rag/tests/test_chunker.py rag/tests/test_worker_pipeline.py
git commit -m "test: image_ocr/EasyOCR 依存テストを削除し caption/text 取り込みを検証"
```

---

### Task 5: 起動時 preload を更新（OCR preload 削除・VLM モデル preload 追加）

**Files:**
- Modify: `rag/app/main.py:25-31`
- Test: `rag/tests/test_preload.py`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_preload.py` を新規作成:

```python
import app.main as main_module


def test_vlm_preload_invoked_for_hybrid(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module.settings, "parse_backend", "hybrid-auto-engine")
    monkeypatch.setattr(main_module, "_fetch_vlm_model",
                        lambda: calls.append("fetch"))
    main_module._maybe_preload_vlm()
    assert calls == ["fetch"]


def test_vlm_preload_skipped_for_pipeline(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module.settings, "parse_backend", "pipeline")
    monkeypatch.setattr(main_module, "_fetch_vlm_model",
                        lambda: calls.append("fetch"))
    main_module._maybe_preload_vlm()
    assert calls == []
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && uv run pytest tests/test_preload.py -v`
Expected: FAIL（`_maybe_preload_vlm` / `_fetch_vlm_model` が未定義）

- [ ] **Step 3: 実装**

`rag/app/main.py` を次の形に更新。lifespan 内の OCR preload ブロック（25-31 行）を削除し、VLM preload ヘルパを追加:

```python
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import documents, jobs, retrieve

_state = {"models_loaded": False}

_VLM_BACKENDS = {"hybrid-auto-engine", "vlm-auto-engine"}


def _fetch_vlm_model() -> None:
    """MinerU VLM 重み(MinerU2.5)を modelcache へ取得する。

    初回はオンライン取得、以降は HF_HUB_OFFLINE=1 でキャッシュから読む。
    pipeline(dev/CPU) では呼ばれないため modelscope/vllm 依存も読み込まれない。
    """
    from mineru.utils.models_download_utils import auto_download_and_get_model_root_path
    auto_download_and_get_model_root_path("/", "vlm")


def _maybe_preload_vlm() -> None:
    if settings.parse_backend not in _VLM_BACKENDS:
        return
    try:
        _fetch_vlm_model()
    except Exception as exc:  # noqa: BLE001
        print(f"[lifespan] VLM model preload failed, will lazy-load in worker: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("PRELOAD_MODELS") == "1" and settings.embedder != "stub":
        # preload は best-effort。失敗してもコンテナは落とさず /health は up を返す。
        try:
            from app.embedding.factory import get_embedder
            from app.reranker.factory import get_reranker
            get_embedder()
            get_reranker()
            _state["models_loaded"] = True
        except Exception as exc:  # noqa: BLE001
            print(f"[lifespan] model preload failed, continuing with lazy load: {exc}")
        # VLM 系バックエンド時のみ MinerU2.5 を事前取得（pipeline では何もしない）。
        _maybe_preload_vlm()
    yield


app = FastAPI(title="ARag RAG service", lifespan=lifespan)
app.include_router(documents.router)
app.include_router(jobs.router)
app.include_router(retrieve.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "device": settings.device, "models_loaded": _state["models_loaded"]}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_preload.py -v`
Expected: PASS（2 テスト）

- [ ] **Step 5: コミット**

```bash
git add rag/app/main.py rag/tests/test_preload.py
git commit -m "feat: OCR preload を廃止し VLM 系バックエンド時に MinerU2.5 を事前取得"
```

---

### Task 6: 依存関係の更新（easyocr 削除・gpu extra 追加）

**Files:**
- Modify: `rag/pyproject.toml`
- Modify: `rag/uv.lock`（再生成）

- [ ] **Step 1: `pyproject.toml` を編集**

`dependencies` から `"easyocr",` の行を削除。さらに optional extra を追加（既存に `[project.optional-dependencies]` が無ければ新規追加）:

```toml
[project.optional-dependencies]
# GPU(CUDA) 本番用。MinerU の VLM バックエンド(hybrid/vlm)に必要な vllm 等を追加で導入する。
gpu = ["mineru[vllm]"]
```

注: ベース `dependencies` の `mineru[pipeline]` はそのまま残す（dev/CPU が使う）。

- [ ] **Step 2: lock を再生成**

Run: `cd rag && uv lock`
Expected: `uv.lock` が更新され、easyocr が消え gpu extra の解決が追記される。エラーなく完了。

- [ ] **Step 3: CPU 同期が壊れないことを確認**

Run: `cd rag && uv sync --no-dev --frozen`
Expected: 成功（vllm はベースに入らない＝CPU では導入されない）

- [ ] **Step 4: 純ロジックテストが通ることを確認（easyocr 不在でも import が壊れないこと）**

Run: `cd rag && uv run pytest tests/test_config.py tests/test_mineru_backend.py tests/test_chunker.py tests/test_parse_dispatch.py tests/test_preload.py -v`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add rag/pyproject.toml rag/uv.lock
git commit -m "chore: easyocr 依存を削除し GPU(vllm) 用 optional extra を追加"
```

---

### Task 7: Dockerfile を CPU/GPU ビルド出し分けに対応

**Files:**
- Modify: `rag/Dockerfile`

前提: GPU 実行はホストに NVIDIA ドライバ + nvidia-container-toolkit があり、vllm wheel が同梱する CUDA ランタイムで動く（ベースイメージは slim を維持）。

- [ ] **Step 1: `Dockerfile` を編集**

`RUN uv sync --no-dev --frozen` の行を、ビルド引数 `VARIANT` で分岐する形に変更:

```dockerfile
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
ENV PATH="/app/.venv/bin:$PATH"
# VARIANT=cpu(既定/dev): pipeline のみ。VARIANT=gpu(prod): vllm を含む gpu extra も導入。
ARG VARIANT=cpu
RUN if [ "$VARIANT" = "gpu" ]; then \
        uv sync --no-dev --frozen --extra gpu; \
    else \
        uv sync --no-dev --frozen; \
    fi
```

- [ ] **Step 2: CPU ビルドが通ることを確認**

Run: `cd /Users/ansen/Documents/playground/a-rag && docker compose build rag`
Expected: 成功（VARIANT 未指定＝cpu。従来どおり）

- [ ] **Step 3: コミット**

```bash
git add rag/Dockerfile
git commit -m "build: Dockerfile に VARIANT(cpu/gpu) を追加し GPU ビルドで vllm を導入"
```

---

### Task 8: compose の EasyOCR 環境変数を除去し GPU overlay を追加

**Files:**
- Modify: `docker-compose.yml`（rag / rag-worker の EASYOCR_MODEL_DIR と関連コメントを削除）
- Create: `docker-compose.gpu.yml`

- [ ] **Step 1: `docker-compose.yml` から EasyOCR env を削除**

`rag` サービス（環境変数 41-42 行付近）と `rag-worker` サービス（80-81 行付近）の以下を削除:

```yaml
      # EasyOCR モデルも modelcache に永続化（...）。
      EASYOCR_MODEL_DIR: /root/.cache/easyocr/model
```

`DEVICE: auto` / `HF_HUB_OFFLINE` / `TRANSFORMERS_OFFLINE` / `PRELOAD_MODELS` はそのまま残す。`MINERU_BACKEND` は dev 既定 = pipeline のため明示不要（設定の既定値が pipeline）。

- [ ] **Step 2: `docker-compose.gpu.yml` を新規作成**

```yaml
# 本番(CUDA/GPU)用 overlay。
# 使い方:
#   docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile worker up -d --build
services:
  rag:
    build:
      context: ./rag
      args:
        VARIANT: gpu
    environment:
      DEVICE: cuda
      MINERU_BACKEND: hybrid-auto-engine
    gpus: all

  rag-worker:
    build:
      context: ./rag
      args:
        VARIANT: gpu
    environment:
      DEVICE: cuda
      MINERU_BACKEND: hybrid-auto-engine
    gpus: all
```

注: `docker-compose.yml` の `rag.build` が `./rag`（文字列形式）の場合、overlay の `build.context` + `build.args` でマージ上書きされる。base 側が文字列・overlay 側がマップでも compose はマージ可能。

- [ ] **Step 3: compose 構文の検証**

Run: `cd /Users/ansen/Documents/playground/a-rag && docker compose -f docker-compose.yml -f docker-compose.gpu.yml config >/dev/null && echo OK`
Expected: `OK`（環境変数が cuda / hybrid-auto-engine に解決され、gpus 指定が入る）

- [ ] **Step 4: dev compose 構文の検証**

Run: `cd /Users/ansen/Documents/playground/a-rag && docker compose config >/dev/null && echo OK`
Expected: `OK`（EASYOCR_MODEL_DIR が消えている）

- [ ] **Step 5: コミット**

```bash
git add docker-compose.yml docker-compose.gpu.yml
git commit -m "build: EASYOCR env を除去し GPU(hybrid) 用 compose overlay を追加"
```

---

### Task 9: ドキュメント更新（CLAUDE.md / AGENTS.md 相当の運用メモ）

**Files:**
- Modify: `CLAUDE.md`（コマンド節に GPU 起動とバックエンド切替を追記）

- [ ] **Step 1: `CLAUDE.md` に追記**

`## コマンド` 配下の適切な位置に次のサブ節を追加:

```markdown
### パースバックエンド（CPU/GPU）

MinerU の解析方式は環境変数 `MINERU_BACKEND` で切替える。

- dev（Mac/Docker・CPU）: 既定 `pipeline`。図中テキストは取り込まない。vllm 不要。
- prod（CUDA/GPU）: `hybrid-auto-engine`。VLM(MinerU2.5) が `--image-analysis` で図表を解釈。

GPU 起動（nvidia-container-toolkit 前提、VLM 重みは初回オンライン取得→以降 HF_HUB_OFFLINE）:

\`\`\`bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile worker up -d --build
\`\`\`
```

（コードブロックのバッククォートは実際のファイルでは通常の ``` にする。）

- [ ] **Step 2: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: MINERU_BACKEND と GPU 起動手順を追記"
```

---

### Task 10: GPU 実機検証と eval（CI 外・手動）

**Files:**
- 参照のみ: `rag/eval/`（既存ハーネス）

このタスクは GPU マシン上での手動検証。CI では実行しない。

- [ ] **Step 1: GPU スタックを起動**

Run: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile worker up -d --build`
Expected: rag/rag-worker が起動し、`GET /health` が `{"device":"cuda", ...}` を返す。初回は VLM 重み取得でログに DL 進捗が出る。

- [ ] **Step 2: マイグレーション適用**

Run: `docker compose exec -T rag uv run alembic upgrade head`
Expected: head まで適用。

- [ ] **Step 3: 図表を含むサンプル文書を 1 本 ingest し content_list を実観察**

図やチャートを含む PDF をアップロード（web `/api/upload` もしくは eval アセット）し、worker 完了後に出力を確認:

Run: `docker compose exec -T rag sh -c 'cat $(ls -t /data/uploads/*_mineru/**/*_content_list.json | head -1)' | python -m json.tool | head -80`
Expected: 図中テキストが `image` ブロックの `img_caption` か独立 `text` ブロックのいずれに乗るかを確認する。
判定:
- caption に乗る → 追加対応不要（既存正規化で image チャンク本文に入る）。
- 独立 text ブロックで乗る → 追加対応不要（`_TYPE_MAP` の text 経路で本文チャンク化）。
- どちらでも無い新フィールドに乗る場合のみ、`mineru.py:_block_from_item` の image 分岐で
  そのフィールドを `caption` か `text` に取り込む微修正を追加し、Task 2 のテストに 1 ケース足す。

- [ ] **Step 4: eval で before/after を比較**

Run: `docker compose exec -T rag uv run python -m eval.run`（既存ハーネスの実行コマンドに合わせる。`rag/eval/` の README/エントリを確認）
Expected: 図表系設問の retrieval 指標（hit/recall）が EasyOCR 構成（移行前ブランチ）以上。レポートは `artifacts/rag-eval/` に出力。

- [ ] **Step 5: 結果を記録**

eval レポートの要点（図表系設問の改善有無）を `docs/superpowers/specs/2026-06-07-mineru-hybrid-vlm-ocr-design.md` 末尾に「検証結果」節として追記し、コミット:

```bash
git add docs/superpowers/specs/2026-06-07-mineru-hybrid-vlm-ocr-design.md
git commit -m "docs: hybrid 移行の eval 検証結果を記録"
```

---

## 完了条件（spec の成功基準と対応）

1. dev（CPU・pipeline）で `cd rag && uv run pytest`（DB 不要分）と既存 ingest が従来どおり通る → Task 4/6。
2. prod（CUDA・hybrid）で図表テキストが索引化され eval 指標が EasyOCR 以上 → Task 10。
3. `easyocr` 依存と OCR 専用経路が消える → Task 3/4/6。
4. オフライン運用（HF_HUB_OFFLINE）が初回取得後に維持される → Task 5/8。
