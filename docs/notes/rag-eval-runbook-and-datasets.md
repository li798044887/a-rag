# RAG 評価：別マシン実行手順 と 標準データセット運用

ハーネス本体の設計・構成は [`rag-eval-harness.md`](./rag-eval-harness.md) を参照。
本ノートは (1) まっさらな別マシンでフルスタック評価を回す手順、(2) 結果の判断基準、
(3) 業界標準データセットの併用方針、をまとめる。

## 1. 別マシンでのフルスタック実行（ランブック）

### 0) 前提（最初の1回）
1. Docker / Docker Compose を導入。
2. リポジトリを clone し移動。
3. `cp .env.example .env.local`。検索評価だけなら `ANTHROPIC_API_KEY` は不要
   （回答生成は TS 側のため）。`ARAG_JWT_SECRET` は任意文字列で可。
4. **モデルキャッシュが最重要**。本スタックは `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1`
   （事前キャッシュ前提）。新マシンには BGE-M3 / bge-reranker / MinerU のモデルが無いため、
   そのままだと `ingest` が落ちる。どちらかを選ぶ：
   - **A案（ネットあり）**: `docker-compose.yml` の rag / rag-worker から
     `HF_HUB_OFFLINE` と `TRANSFORMERS_OFFLINE` を一時的に外し、初回 `ingest` で自動取得させる
     （`modelcache` ボリュームに残り、以降はオフラインで可）。
   - **B案（オフライン厳守）**: 既存マシンの `modelcache` Docker ボリュームを書き出して移植
     （`docker run --rm -v arag_modelcache:/c -v $PWD:/o alpine tar czf /o/modelcache.tgz -C /c .`
     → 新マシンで展開）。

### 1) 起動 + マイグレーション
```bash
docker compose --profile worker up -d --build           # infra + rag(eval焼込) + worker
docker compose exec -T rag uv run alembic upgrade head    # rag側DB(contents/documents/chunks/ingest_jobs)
```
> eval コードは Docker イメージに焼き込まれる。**eval を変更したら毎回 `--build`**。

### 2) 取り込み（parse→embed→index）
```bash
docker compose exec -T rag uv run python -m eval ingest
# 期待: 「取り込み完了: N 文書 / owner=__eval__」
```

### 3) 評価実行
```bash
docker compose exec -T rag uv run python -m eval run \
  --gate --baseline eval/baselines/agentic_rag.json --out eval-report.json
echo "EXIT=$?"     # 0=ゲート合格 / 非0=回帰
```

### 4) スモークのみ（モデル不要・数秒、CI Layer1 と同じ）
```bash
cd rag && uv run pytest --noconftest \
  tests/test_eval_metrics.py tests/test_eval_dataset.py \
  tests/test_eval_runner.py tests/test_eval_report.py -v
```

## 2. 評価の判断基準

| 指標 | 意味 | 見方 |
| --- | --- | --- |
| **recall@k** | 正解**文書**を上位 k に取れたか | 検索の心臓。低い→embedding / chunking / `candidate_k` / owner スコープ |
| **MRR / nDCG@k** | 正解が**上位**に来るか（順序品質） | 1.0 に近いほど良い。recall 高いのにこれが低い→**リランカ**を疑う |
| **precision@k** | k 件中の正解率 | 正解1件 + top_k=6 だと上限 ≈0.17。**低くても異常ではない**。多正解ケースでのみ意味を持つ |
| **fact_coverage** | 必要事実が top-k 本文に出たか | recall=1 なのに低い→「文書は当てたが答えに要る証拠が top-k に無い」。chunk 粒度・周辺拡張・表/画像索引を疑う |
| **gate 終了コード** | 集計平均が golden の `thresholds` 以上か | 0=合格 / 非0=回帰。CI はこれで判定 |
| **ベースライン差分** | 前回実測との差 | 負=回帰 / 正=改善。どの指標が落ちたかで原因を絞る |

**原因切り分けの早見表**
- recall が低い → embedding モデル / チャンク化 / `candidate_k` / owner スコープ
- recall 高いが nDCG 低い → リランカ
- recall 高いが fact_coverage 低い → チャンク粒度・周辺拡張・表/画像が索引外
- 一部だけ回帰 → per-case テーブルで落ちた `id` を特定

> 初回実測（2026-06-05, bge-m3 + bge）: recall@5=1.0 / MRR=1.0 / nDCG=0.995 /
> precision@k=0.278 / fact_coverage=0.833。`case2-image-grounding` のみ fact_coverage=0
> （図面由来事実が画像チャンク＝索引外のため）。

## 3. 標準データセットの併用方針

自作デモ黄金集は「企業文書の難所（跨ぎ表・図面・複数ファイル結合）」を突くもので、
標準データセットには無い価値がある。一方「検索パイプラインが基本的に健全か」は標準集で測れる。
**二段構え（標準集＝管線の健全性 / 自作集＝業務シナリオ）が定石**。

### 検索（本ハーネスの文書レベル recall/nDCG に直結）
- **BEIR** — ゼロショット検索のデファクト標準。NQ / HotpotQA / FiQA / SciFact / TREC-COVID 等を
  `qrels`（文書レベル相関ラベル）付きで提供。**本設計と最も相性が良い**。
- **MS MARCO** — passage ranking の大規模標注。MRR@10 が定番。
- **MTEB / Retrieval** — 埋め込みモデル選定のデファクト（中身は BEIR ベース）。embedder 比較に。

### 多言語（zh/ja 両対応のため重要）
- **MIRACL** — 多言語検索（**中文 zh・日本語 ja を含む**）。qrels あり。
- **C-MTEB**（中文）/ **JMTEB**（日本語）/ **T2Ranking・DuReader**（中文）。

### 多ホップ・知識集約（複数文書結合ケースに対応）
- **HotpotQA**（多ホップ）/ **KILT**（provenance 文書ラベル＝帰属/faithfulness 向け）/
  **CRAG (Meta, KDD Cup 2024)**（実世界 QA + 検索の総合 RAG ベンチ）。

### 回答品質（次フェーズ faithfulness 用、※データセットではなく枠組み）
- **RAGAS** — faithfulness / answer relevancy / context precision・recall を LLM-judge で測る。
  スペックで「次フェーズ」とした TS 側回答評価（`src/eval/`）に直結。
- **TREC RAG / TREC Deep Learning** — 人手標注のある権威ベンチ。

### 推奨ステップ
1. **BEIR の小規模サブセット（SciFact, NFCorpus 等）** をハーネスに通し、標準指標で検索管線の健全性を担保。
2. zh/ja 検証に **MIRACL-zh / MIRACL-ja（または C-MTEB / JMTEB）** を追加。
3. **領域難所（表・図面・多ファイル）は自作黄金集を維持**——標準集には無い差別化テスト。

> 注意：BEIR/MIRACL はプレーンな短文 passage 集なので、**MinerU の表/画像パースの強みは測れない**。
> だから自作集との併用が必要。

## 4. BEIR/MIRACL をハーネスに通す拡張計画（未実装・骨子）

本ハーネスは「文書レベル正解 + fact_coverage」設計なので、BEIR の文書レベル `qrels` と自然に対応する。
追加するのは**データセットアダプタ**のみ（メトリクス/ランナーは再利用）。

- **入力形式**: BEIR は `corpus.jsonl`（`_id`,`title`,`text`）/ `queries.jsonl`（`_id`,`text`）/
  `qrels/*.tsv`（`query-id  corpus-id  score`）。
- **取り込み**: corpus はプレーンテキストなので **MinerU を介さずテキストパーサ経路**で取り込む
  （`app/parsing/dispatch.py` の拡張子ディスパッチ。`.txt` 等で投入）。`corpus.ingest_files` を
  「テキスト本文を直接 1 文書 = 1 corpus エントリとして登録」する派生関数に拡張。
- **ゴールデン生成**: `qrels` を `dataset.py` の `Case`（`relevant_documents` = score>0 の corpus-id 群、
  `key_facts` は無し＝検索のみ評価）へ変換するローダ `eval/adapters/beir.py` を追加。
- **指標**: 既存 `metrics.py` をそのまま使用（recall@k / nDCG@k / MRR）。fact_coverage は空 facts で 1.0。
- **スケール対策**: BEIR は corpus が大きい。owner スコープ（`__eval_beir_<dataset>__`）で隔離し、
  `candidate_k` を上げる。CI には載せず手動/夜間ジョブで回す。

実装時は別 issue/スペックに切り出す（本フェーズ範囲外）。
