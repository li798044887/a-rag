# MinerU hybrid(VLM) バックエンドへの移行と EasyOCR 廃止 — 設計

- 日付: 2026-06-07
- 対象: `rag/`（パース・チャンク・worker・Docker・依存）
- 関連: `2026-06-06-ocr-image-indexing-design.md`（EasyOCR による画像内 OCR。本設計でこれを置換）

## 背景・目的

直近で図中テキストを索引化するため EasyOCR を導入した（`rag/app/parsing/ocr.py`）。しかし
EasyOCR は利便性・多言語カバレッジ重視のエンジンで、CJK・複雑レイアウト・図中テキストの
精度は現行 SOTA に劣る。**精度を優先**し、かつ CUDA(NVIDIA/Linux) GPU を利用できる前提が
得られたため、MinerU 自体を高精度モード（`hybrid-auto-engine` = 構造解析パイプライン + VLM）
に切り替え、図表テキストの認識・解釈を MinerU に一本化する。これにより EasyOCR の追加経路を
丸ごと廃止し、メンテ対象を単純化する。

### 確定した方針（合意済み）

- デプロイ: rag スタック（rag API + worker）ごと CUDA GPU 機に載せる（topology A）。
- 開発: Mac でも rag は Docker(Linux)/CPU で動く。dev は `pipeline` バックエンドで軽く回す。
- dev の図中テキスト: 取り込まない（図は画像のまま）。dev/prod で忠実度が異なるのを許容。
- 本番バックエンド: `hybrid-auto-engine`（VLM + 構造解析）。`--image-analysis` で図表解析。
- モデル供給: 初回だけオンライン取得 → 以降 `HF_HUB_OFFLINE=1` でキャッシュ運用。
- Mac MPS は対象外（Docker に Apple GPU は渡らず、高速 VLM エンジン vllm/lmdeploy は CUDA 専用）。

## アーキテクチャ：構成駆動のバックエンド切替

「Mac か CUDA か」ではなく、同一 Linux イメージ系で **device とバックエンドを構成で切替**する
問題に落とす。

| | 開発（Mac / Docker・CPU） | 本番（CUDA / GPU） |
|---|---|---|
| `DEVICE` | `cpu`（auto 解決） | `cuda` |
| `MINERU_BACKEND`（新設） | `pipeline` | `hybrid-auto-engine` |
| 図中テキスト | なし（図は画像のまま） | VLM が `--image-analysis` で解釈 |
| VLM 推論 | しない（vllm 不要） | vllm + `opendatalab/MinerU2.5-Pro-2604-1.2B`（1.2B） |
| EasyOCR | 廃止 | 廃止 |

MinerU は vllm 等を遅延 import する（`backend/vlm/vlm_analyze.py` の各エンジンブランチ内で
import）。`pipeline` を選ぶ限り CPU/dev 側で vllm は読み込まれず壊れない。

## コンポーネント別の変更

### 設定（`rag/app/config.py`）
- `parse_backend: str = "pipeline"` を追加（env `MINERU_BACKEND`）。validator で
  `pipeline` / `hybrid-auto-engine`（将来必要なら `vlm-auto-engine`）に限定。
- `device` は現状の `auto → cuda/cpu` を維持。

### パース（`rag/app/parsing/mineru.py`）
- 現状ハードコードの `-b pipeline` を `settings.parse_backend` 駆動へ変更。
- hybrid 時は MinerU 既定で `--image-analysis` が有効（図表解析が走る）。
- 出力は従来どおり `*_content_list.json` を読む経路を維持。

### 図表テキストの格納先（実装時に実出力で確定）
唯一、実出力を見て確定すべき点。hybrid でも同じ `*_content_list.json` を出すが、図中テキストが
`image` ブロックの `img_caption`/説明文に乗るか、独立 `text` ブロックで展開されるかは挙動依存。
- 既存正規化を活かす: `_block_from_item` は既に `img_caption` を `caption` に取り込む。
  caption に乗るなら現行 image チャンク本文ロジックでそのまま拾える。
- 独立 text ブロックなら `_TYPE_MAP` で text として本文チャンクに自然に入る。
- 実装時に GPU 機でサンプル1本を流して `content_list.json` を実観察し、必要なら正規化を微調整。
- **独自チャンク型 `image_ocr` は廃止**し、MinerU が出す構造（caption/text）に一本化する。

### 廃止する EasyOCR 経路
- `rag/app/parsing/ocr.py` … ファイル削除
- `rag/app/worker.py` … `ocr_images(...)` 呼び出し削除
- `rag/app/main.py` … OCR preload（lifespan 内）削除
- `rag/app/parsing/types.py` … `ParsedBlock.ocr_text` 削除
- `rag/app/chunking/chunker.py` … `image_ocr` チャンク生成削除
- `rag/pyproject.toml` … `easyocr` 依存削除
- compose の `EASYOCR_MODEL_DIR` 等の env、`rag/tests/test_ocr.py`、chunker の image_ocr ケース削除/更新

### Docker（CPU 用 / GPU 用のビルド出し分け）
- `rag/Dockerfile` に `ARG VARIANT=cpu`（`cpu` | `gpu`）。
  - `cpu`: 従来 `python:3.11-slim`、`uv sync` は `mineru[pipeline]` のみ。
  - `gpu`: CUDA ランタイム入りベース（例 `nvidia/cuda:12.x-cudnn-runtime-ubuntu22.04` + Python）、
    extras に vllm + MinerU の vlm 依存を追加（`uv sync --extra gpu`）。
- `pyproject.toml`: `easyocr` 削除。VLM 依存は optional extra（`[project.optional-dependencies] gpu`）。

### compose の出し分け
- `docker-compose.yml`: dev 既定（CPU・`MINERU_BACKEND=pipeline`）を維持。
- `docker-compose.gpu.yml`（新規 overlay）で本番上書き:
  - `build.args.VARIANT=gpu`
  - `DEVICE=cuda` / `MINERU_BACKEND=hybrid-auto-engine`
  - GPU 予約（`gpus: all` もしくは `deploy.resources.reservations.devices`、nvidia-container-toolkit 前提）
  - rag と rag-worker の両方に適用（worker が実パースを担うため GPU 必須）。

### モデルのオフライン供給（`HF_HUB_OFFLINE=1` 維持）
- VLM `opendatalab/MinerU2.5-Pro-2604-1.2B` を `modelcache` ボリュームへ事前取得。
- 既存 PRELOAD 機構（`main.py` lifespan）を拡張し、VLM 系バックエンド時に
  `auto_download_and_get_model_root_path("/","vlm")` 相当で `modelcache` に落とす。
  EasyOCR preload は削除。
- 運用: 初回だけオンライン取得 → 以降 `HF_HUB_OFFLINE=1` でキャッシュ運用（BGE-M3 等と同思想）。
- 完全閉域機向けの逃げ道として `MINERU_MODEL_SOURCE=local` + `get_local_models_dir()` 指定も
  ドキュメント化（基本線は採用しない）。

## データフロー（本番 hybrid）

アップロード → `ingest_jobs`(Redis) → rag-worker が `parse_document`（dispatch）→
`mineru.parse`（`-b hybrid-auto-engine`、VLM が図表解析）→ `*_content_list.json` を正規化
（図表テキストは caption/text として取り込み）→ チャンク化 → BGE-M3 埋め込み → Qdrant 登録。

## テスト・検証

### 単体（CPU/dev で完結・CI 常時）
- `test_parse_dispatch.py`: pipeline 既定の振り分け維持。backend 設定が `-b` 引数に反映される
  ことを subprocess モックで検証（hybrid 指定で `-b hybrid-auto-engine`）。
- `test_chunker.py`: `image_ocr` ケース削除 → caption 付き image ブロックが本文に取り込まれる
  ケースへ置換。
- `test_ocr.py`: 削除。
- config validator: `MINERU_BACKEND` の許容値・既定のテスト追加。
- いずれも vllm/GPU 不要で回ること。

### 結合・実機（GPU 機で手動／専用ジョブ）
- サンプル文書1本を ingest し `content_list.json` を実観察 → 図表テキスト格納先を確定。
- worker パイプライン（パース→チャンク→埋め込み→Qdrant）が hybrid で通ることを確認。

### eval（`rag/eval/`）
- before(EasyOCR/pipeline) / after(hybrid) を比較。図表系設問の retrieval 指標（hit/recall）。
- コレクションは embedder 版付き（`[[project_qdrant_collection_versioned]]`）。再 ingest で再索引化。

## 成功基準
1. dev（CPU・`pipeline`）で pytest 一式と既存 ingest フローが従来どおり通る（vllm 不在でも壊れない）。
2. prod（CUDA・`hybrid-auto-engine`）で図表テキストが索引化され、eval の図表系設問で retrieval
   指標が EasyOCR 構成以上。
3. `easyocr` 依存が消え、OCR 専用コード経路が無くなる。
4. オフライン運用（`HF_HUB_OFFLINE=1`）が初回取得後に維持される。

## ロールバック
- `MINERU_BACKEND=pipeline` に戻せば即座に従来パース挙動へ復帰（図中 OCR は失われるが索引化は継続）。

## スコープ外 / YAGNI
- `vlm-auto-engine`（純 VLM）/ `*-http-client`（別ホスト推論）/ lmdeploy は採用しない。
- Mac MPS / mlx-engine ネイティブ実行は採用しない。
- 図表の意味理解を用いた追加メタデータ抽出など、索引化以上の高度化は本設計では扱わない。
