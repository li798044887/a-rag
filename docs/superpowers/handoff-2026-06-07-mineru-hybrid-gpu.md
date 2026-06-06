# Handoff: MinerU hybrid(VLM) GPU 検証（Windows で継続）

- 日付: 2026-06-07
- ブランチ: `feat/mineru-hybrid-vlm-ocr`
- PR: https://github.com/was865/a-rag/pull/23
- 関連: 設計 `docs/superpowers/specs/2026-06-07-mineru-hybrid-vlm-ocr-design.md` / 計画 `docs/superpowers/plans/2026-06-07-mineru-hybrid-vlm-ocr.md`

## これまでに完了していること（CPU/Mac 側）

実装 T1〜T9 は完了・コミット済み・push 済み。

- `MINERU_BACKEND` 設定（既定 `pipeline`、許容 `pipeline`/`hybrid-auto-engine`/`vlm-auto-engine`）
- `mineru.parse` が `settings.parse_backend` で `-b` を切替
- EasyOCR 経路を完全削除（`parsing/ocr.py`・`ParsedBlock.ocr_text`・worker の `ocr_images`・chunker の `image_ocr` chunk・OCR preload・`easyocr` 依存）
- VLM 系バックエンド時のみ起動時に MinerU2.5 を事前取得（`rag/app/main.py` の `_maybe_preload_vlm`/`_fetch_vlm_model`、CPU パスでは mineru/vllm を遅延 import）
- Dockerfile に `VARIANT`(cpu/gpu)。gpu で `--extra gpu`(vllm) を導入
- `docker-compose.gpu.yml`（`VARIANT=gpu` / `DEVICE=cuda` / `MINERU_BACKEND=hybrid-auto-engine` / `gpus: all`）
- DB 非依存ユニットテスト 47 passed、CPU イメージのクリーンビルドで easyocr 不在を確認済み

## Windows で残っている作業（= 計画の T10）

CUDA 実機でのみ可能な検証。**コード変更は基本不要**で、運用検証と「図中テキストの格納先確認 → 必要時のみ微修正」が主目的。

---

## 0. Windows 前提セットアップ（重要）

1. **Docker Desktop（WSL2 バックエンド）** を有効化。Linux コンテナとして動くため、コンテナ内 vllm は問題なく動作する。
2. **NVIDIA GPU ドライバ + WSL2 の GPU サポート**。WSL2 内で GPU が見えることを確認:
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
   ```
   GPU が一覧表示されれば OK。出なければ Docker Desktp の設定（Resources → WSL Integration / GPU）とドライバを見直す。
3. **改行コード**: リポジトリは LF 前提。`git config core.autocrlf input` を推奨（特に `*.sh` 相当やシェルを含む Dockerfile の `RUN if [...]` が CRLF だと壊れる）。
4. コード取得:
   ```bash
   git fetch origin
   git checkout feat/mineru-hybrid-vlm-ocr
   git pull
   ```

> 注: パスは Mac の `/Users/...` と異なる。以下コマンドはリポジトリのルートで実行する前提（Windows なら例: `C:\Users\...\a-rag`、WSL なら `/mnt/c/...` など）。`docker compose` はリポジトリルートで叩く。

---

## 1. モデルの初回オンライン取得（最大の落とし穴）

`docker-compose.yml` は `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` を**常時**設定しており、`docker-compose.gpu.yml` はこれを上書きしない。**新しい Windows マシンでは `modelcache` ボリュームが空**なので、以下すべてが未取得:

- BGE-M3（埋め込み）
- bge reranker
- MinerU pipeline モデル（PDF-Extract-Kit）
- **MinerU2.5 VLM（`opendatalab/MinerU2.5-Pro-2604-1.2B`）** ← 今回の新規

`HF_HUB_OFFLINE=1` のままだと初回 preload がすべて失敗する。**初回だけオフラインフラグを外して全モデルを取得し、その後オフラインへ戻す**（設計の「初回だけオンライン取得」方針）。

### やり方 A（推奨・手軽）: 一時的なローカル overlay を作って初回起動

リポジトリルートに `docker-compose.bootstrap.yml`（コミット不要・使い捨て）を作る:

```yaml
# 初回モデル取得用の使い捨て overlay（コミットしない）。取得後は使わない。
services:
  rag:
    environment:
      HF_HUB_OFFLINE: "0"
      TRANSFORMERS_OFFLINE: "0"
  rag-worker:
    environment:
      HF_HUB_OFFLINE: "0"
      TRANSFORMERS_OFFLINE: "0"
```

初回だけこれを重ねて起動（GPU + bootstrap）:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.bootstrap.yml --profile worker up -d --build
```

rag コンテナの起動時 preload で BGE-M3 / reranker / MinerU2.5 が `modelcache`(`/root/.cache`) に落ちる。ログで進捗を確認:

```bash
docker compose logs -f rag
# "model preload" や VLM 取得のダウンロードが流れ、最終的に /health が models_loaded:true になればOK
curl http://localhost:8000/health
```

> huggingface.co に到達できない環境なら、HF の代わりに **ModelScope** から取る:
> `rag`/`rag-worker` の environment に `MINERU_MODEL_SOURCE: modelscope` を足す（bootstrap overlay に併記）。BGE-M3/reranker は transformers 経由なので、その場合は別途 HF ミラー or 事前配置が必要になる点に注意。

取得が一通り終わったら **bootstrap overlay を外して通常 GPU 起動に切替**（以降は `HF_HUB_OFFLINE=1` のままキャッシュから読む）:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile worker up -d
```

### やり方 B: 事前 CLI ダウンロード

ネットワークのある環境で `modelcache` ボリュームへ直接落としてもよい:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml run --rm \
  -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 rag \
  python -c "from mineru.utils.models_download_utils import auto_download_and_get_model_root_path as f; print(f('/', 'vlm'))"
```

（BGE-M3 / reranker / pipeline も同様に preload を一度走らせれば取得される。）

---

## 2. マイグレーション適用

```bash
docker compose exec -T rag uv run alembic upgrade head
```

（web 側 Drizzle は今回の RAG 変更に無関係。フルの動作確認をするなら CLAUDE.md の初回起動手順に従う。）

---

## 3. 図中テキストの格納先を実観察（← 唯一の要判断ポイント）

図・チャート・スクショを含む PDF を 1 本 ingest する（web の `/api/upload` でも、`rag/eval/assets` の図入り資料でも可）。worker 完了後に MinerU 出力を確認:

```bash
docker compose exec -T rag sh -c 'cat $(ls -t /data/uploads/*_mineru/**/*_content_list.json | head -1)' | python -m json.tool | head -120
```

**判定:**
- 図中テキストが `image` ブロックの `img_caption` に乗る → 追加対応**不要**（既存 `_block_from_item` が caption を取り込み、chunker が image チャンク本文に含める）。
- 図中テキストが独立した `text` ブロックで出る → 追加対応**不要**（`_TYPE_MAP` の text 経路で本文チャンク化）。
- 上記どちらでもない**新フィールド**に乗る場合のみ → `rag/app/parsing/mineru.py` の `_block_from_item` の image 分岐で、そのフィールドを `caption` か `text` に取り込む微修正を入れ、`rag/tests/test_mineru_backend.py` に 1 ケース追加。

> hybrid は `--image-analysis` が既定有効。図表が解釈されているかは content_list の該当 image 周辺を見れば分かる。

---

## 4. eval で before/after 比較

コレクションは embedder 版付き（`arag_chunks__{embedder}`）。hybrid で再 ingest して再索引化した上で、`rag/eval/` のハーネスを実行:

```bash
# 実行コマンドは rag/eval/ の README / エントリを確認して合わせる（例）
docker compose exec -T rag uv run python -m eval.run
# レポートは artifacts/rag-eval/ に出力される
```

**確認:** 図表系設問の retrieval 指標（hit / recall）が、移行前（EasyOCR=`main` ブランチ）と同等以上か。before を取りたい場合は `main` を別途立てて測るか、過去レポートと比較。

---

## 5. DB 統合テスト（フルスタックで）

```bash
# Postgres/Qdrant/Redis/rag が起動している状態で
docker compose exec -T rag uv run pytest tests/test_worker_pipeline.py -v
```

`test_worker_pipeline.py` は今回 `ocr_images` monkeypatch と `image_ocr` テストを除去済み。フルスタックで緑になることを確認。

---

## 完了条件（設計の成功基準）

- [ ] GPU(cuda)・`hybrid-auto-engine` で図表テキストが索引化される（手順3で確認）
- [ ] eval の図表系設問で retrieval 指標が EasyOCR 構成以上（手順4）
- [ ] `test_worker_pipeline.py` 等の DB 統合テストが緑（手順5）
- [ ] 初回取得後は `HF_HUB_OFFLINE=1` のままキャッシュ運用が回る（手順1）

完了したら、設計ドキュメント末尾に「検証結果」節を追記してコミット → PR #23 を更新。

---

## ロールバック

不安定なら `MINERU_BACKEND` を外す（=既定 pipeline）か `pipeline` を明示すれば、従来のパース挙動に即復帰する（図中 OCR は無くなるが索引化は継続）。GPU overlay を使わず `docker compose --profile worker up -d` で起動すれば dev と同じ CPU/pipeline 構成になる。

## 補足・ハマりどころ

- **gpu overlay は HF_HUB_OFFLINE を上書きしない**（手順1参照）。恒久的にオンライン取得を許したいなら gpu overlay 側に `HF_HUB_OFFLINE: "0"` を足す手もあるが、設計方針は「初回のみオンライン」。
- **vllm は Linux 専用**だが、Docker(WSL2) の Linux コンテナ内で動くので Windows ホストでも問題なし。
- **`modelcache` ボリュームは rag↔rag-worker 共有**。rag 側 preload で取得すれば worker も再利用する（再 DL しない）。
- VLM 取得引数 `auto_download_and_get_model_root_path("/", "vlm")` は MinerU 自身の `vlm_analyze.py` と同一の正規用法（`/` は「リポジトリ全体取得」の意。誤りではない）。
