# RAG 品質評価ハーネス 設計

- Issue: [#13 RAG品質評価ハーネス](https://github.com/was865/a-rag/issues/13)
- 日付: 2026-06-05
- ステータス: 設計合意済み（実装計画はこの後 writing-plans で作成）

## 背景と目的

検索・回答品質を定量的・回帰的に測る仕組みが無く、精度・ハルシネーションを数値で追えない。
本スペックは **検索評価を軸に** 受け入れ条件3つすべてを束ねる:

1. ゴールデンセット + 検索品質メトリクス（recall@k, faithfulness 等）
2. CI で回帰評価を実行
3. 埋め込みモデル更新時の再インデックス / バージョニング方針

回答生成は **TS 側（`src/lib/agent/run.ts`）**、検索は **Python 側（`rag/`）** にあるため、
評価も自然に2層に分かれる。本フェーズは **Python の検索評価ハーネスを完全実装** し、
回答品質（faithfulness, LLM-judge）と埋め込みバージョニングの一部は **方針 + 拡張ポイント** として定義する。

## スコープ決定（ブレストの結論）

- **スコープ**: 検索評価を軸に全条件を1スペックで扱う。検索メトリクス + ゴールデンセット + CI をコアとして完全設計し、
  回答品質と埋め込み再インデックスは同一スペック内で「方針 + フック」を定義（完全実装は拡張）。
- **正解ラベル**: ハイブリッド = **文書レベル + 事実グラウンディング**。チャンクIDに依存せず再インデックス耐性を持たせる。
- **CI 実行モデル**: 2層。PR は軽量スモーク + ハーネス検証（fake embedder + 小さな合成コーパス）、
  実評価（実 BGE-M3 + Qdrant）は docker compose でローカル/セルフホスト/手動実行。
- **全体方式**: `rag/eval/` 独立パッケージ + 純粋メトリクス + retrieve 注入式ランナー（案A）。

### 現状コードの接地ポイント

- 文書は **コンテンツアドレス方式**。検索は `owner_user_id → content_hashes` でスコープ
  （`rag/app/retrieval/service.py` `_resolve_scope`）。
- `RetrievedChunk` は `document_id` / `content_hash` / `text` / `heading_path` / ページ情報 / `score` を持つ
  → 文書レベル recall は「retrieve 結果チャンクの所属 `document_id` 集合」対「正解文書集合」で算出可能。
- Qdrant コレクションは現状 `arag_chunks` 固定・dim 1024（`rag/app/vectorstore/qdrant.py`）。
  **モデル名がコレクション名に入っていない** → 条件3の自然なフック地点。
- `content_hash` は再インデックスでも安定。ゴールデン作者が知るのは **ファイル名** なので、
  ラベルはファイル名で書き、ハーネスが取り込み後に `filename → document_id/content_hash` を解決する。

## アーキテクチャ（ディレクトリ / 境界）

```
rag/eval/
  __init__.py
  __main__.py        # CLI: `uv run python -m eval <ingest|run> ...`
  dataset.py         # ゴールデンの pydantic モデル + YAML ローダ + 検証
  metrics.py         # 純関数のみ（I/O なし）: recall@k / precision@k / mrr / ndcg@k / fact_coverage / normalize
  corpus.py          # filename→document 解決 + 同期取り込み（DB/Qdrant に触る唯一の層）
  runner.py          # retrieve 関数を注入で受け、ケース毎に実行 → メトリクス集計
  report.py          # JSON + Markdown 生成 / ベースライン差分 / 閾値ゲート
  README.md          # 実行手順（ローカル/フルスタック）
  golden/
    agentic_rag.yaml # デモ8ケースから構築するゴールデン
  baselines/
    agentic_rag.json # 意図的に更新するメトリクス基準値（回帰検出用）
rag/tests/
  test_eval_metrics.py   # メトリクス純関数（既知入出力）
  test_eval_dataset.py   # スキーマ検証・正規化
  test_eval_runner.py    # FakeEmbedder + インメモリ store + 小さな合成コーパスでスモーク
.github/workflows/
  rag-eval-smoke.yml     # Layer 1: 毎PR
  rag-eval-full.yml      # Layer 2: workflow_dispatch / nightly（既定オフ）
```

**境界の要点**:

- `metrics.py` は I/O 一切なし → 単体テスト容易。
- `runner.py` は `retrieve` を **引数で注入**（本番 = `app.retrieval.service.retrieve`、スモーク = fake）。
- DB / Qdrant に触れるのは `corpus.py` のみ。
- 各ユニットは「何をするか / どう使うか / 何に依存するか」が単独で説明できる。

## ゴールデンセットのデータモデル

`dataset.py`（pydantic）。ラベルは **ファイル名 + 事実文字列**（チャンクID非依存 = 再インデックス耐性）。
母体は `docs/demo-files/AGENTIC_RAG_DEMO_CASES.md` の8ケース（質問例・期待回答の要点・対象PDF を既に持つ）。

```yaml
# rag/eval/golden/agentic_rag.yaml
suite: agentic_rag_demo
owner_user_id: __eval__          # 評価専用オーナー（共有DBを汚さない隔離キー）
documents:                        # このスイートで取り込む原本
  - 06-multi-file-requirement-request.pdf
  - 07-multi-file-security-policy.pdf
  - 08-multi-file-vendor-quotes.pdf
thresholds:                       # ゲート基準（実評価ジョブで使用）
  recall_at_5: 0.80
  fact_coverage: 0.75
cases:
  - id: case3-edge-gateway-select
    query: "エッジAIゲートウェイを1つ選ぶならどれ？要求仕様・規程・見積を照合して"
    rewritten: null               # 任意。クエリ書き換えを固定したい時のみ
    top_k: 6
    relevant_documents:           # 文書レベル正解（ファイル名）
      - 06-multi-file-requirement-request.pdf
      - 07-multi-file-security-policy.pdf
      - 08-multi-file-vendor-quotes.pdf
    key_facts:                    # 事実グラウンディング（any のいずれかが top-k 本文に出現で充足）
      - any: ["AlphaGate X2"]
      - any: ["92万円", "920000", "92万"]
      - any: ["2026-06-05"]
```

- `key_facts[i].any` は表記ゆれ吸収のための別名リスト（全角/半角・通貨表記など）。
  1事実につき `any` のどれか1つが出現すれば充足。
- スキーマ検証: 必須フィールド、`relevant_documents ⊆ documents`、`top_k > 0`、空 `key_facts` 許容（検索のみ評価）。

## メトリクス定義（`metrics.py`）

retrieve 結果（top-k チャンク列）から計算。文書集合 = 「チャンクの所属 `document_id` を順位順に重複排除した列」。

**検索メトリクス（文書レベル）** — 正解集合 `R`（複数可）、retrieve 文書順位列 `D`:

- **recall@k** = |unique(D[:k]) ∩ R| / |R|
- **precision@k** = |unique(D[:k]) ∩ R| / k
- **MRR** = 1 / (R に属する最初の文書の順位)。R に1件も当たらなければ 0。
- **nDCG@k** = DCG(D[:k], R) / IDCG(|R|, k)。gain は R 所属で 1、それ以外 0。

**事実グラウンディング（回答可能性プロキシ）**:

- top-k チャンクの `text`（取得できれば `expanded_text` も）を正規化連結したコーパスに対し、
  各 `key_fact` の `any` 別名のいずれかが部分一致すれば充足。
- **fact_coverage** = 充足事実数 / 全事実数
- `normalize_text`: 全角→半角数字、空白圧縮、ケース無視。LLM 不要で決定的。

**集計**: ケース毎の表 + スイート平均（mean recall@5, mean fact_coverage 等）。

## 取り込み（`corpus.py`）と実行（`runner.py`）

- `eval ingest`: `golden/*.yaml` の `documents` を **実パイプライン（parse→chunk→embed→Qdrant upsert）を同期実行** で
  `owner=__eval__` に取り込む。worker のパイプライン関数を直接呼ぶ（arq キューを介さず決定的に）。
  既存 `content_hash` があれば冪等スキップ。
- `eval run`:
  1. `corpus.resolve` で `filename → (document_id, content_hash)` を解決
     （未取り込みなら欠落ファイル名を列挙してエラー + `eval ingest` を案内）。
  2. 各ケースで `retrieve(query, owner=__eval__, top_k)` を実行。
  3. `metrics` で集計、`report` で JSON + md 生成。
  4. `--gate` 指定時、`thresholds` 未達なら **非ゼロ終了** + 未達ケース/指標を表示。
  5. `--baseline baselines/agentic_rag.json` 指定時、各指標の Δ を表示（回帰検出）。

## CI（2層）

現状 `.github/` は存在しないため新規作成。

- **Layer 1 — `rag-eval-smoke.yml`（毎PR / GitHub-hosted）**
  `pytest rag/tests/test_eval_*.py`。FakeEmbedder + インメモリ store + 2文書の合成コーパス + 極小ゴールデンで、
  **メトリクス計算・スキーマ検証・ランナー結線** を検証。モデル/Qdrant/Postgres 不要・高速・決定的。
  = 「ハーネスが壊れていない」ことの保証。
- **Layer 2 — `rag-eval-full.yml`（`workflow_dispatch` + 任意で nightly schedule / セルフホスト or ローカル）**
  docker compose でフルスタック起動 → `eval ingest` → `eval run --gate --baseline ...` →
  `eval-report.json` をアーティファクト化。HF オフライン制約のため GitHub-hosted では既定オフ、
  手動/セルフホスト実行を前提。
  ローカル実行コマンドは `rag/eval/README.md` に明記:
  `docker compose --profile worker up -d && docker compose exec -T rag uv run python -m eval run --gate`。

## 条件3: 埋め込みモデル更新時の再インデックス / バージョニング方針

現状ハードコードの `arag_chunks` を **モデル識別子付きコレクション名** に切り出すのが最小フック。

- **コレクション命名**: `settings.qdrant_collection`（既定 `f"arag_chunks__{settings.embedder}"`、例 `arag_chunks__bge-m3`）。
  `QdrantStore(collection=...)` の既定をこれに。dim もモデルから導出。
- **ブルーグリーン再インデックス方針**（ドキュメント + `eval reindex` の骨子）:
  1. 新モデルを設定 → 新コレクション名が導出される。
  2. `chunks`（Postgres）から全チャンクを新モデルで再埋め込みし新コレクションへ upsert。
  3. **同一ゴールデンで `eval run --gate` を新コレクションに対し実行**（= モデル更新の品質ゲート）。
  4. ゲート通過時のみサーブ切替（設定更新）→ 旧コレクション drop。
  5. ロールバックは設定を旧コレクション名に戻すだけ。
- **バージョン記録**: チャンク payload に `embed_model` を付与 + コレクション名自体がバージョン。
  軽量メタ（`baselines/` のレポートに `embed_model` / `dim` / `chunk_count` を含める）で監査可能に。
- **本スペックの実装範囲**: コレクション命名の切り出し + 方針ドキュメント + ゲート結線。
  `eval reindex` の完全実装は拡張ポイント（骨子のみ）。

## 条件1拡張: 回答品質（faithfulness）の方針（本フェーズは方針のみ）

回答生成は TS 側（`src/lib/agent/run.ts`）にあるため、回答品質評価は別ハーネス（`src/eval/`）として
設計のみ提示し、本フェーズでは実装しない（CI を安価・決定的に保つため）。

- **同一ゴールデン YAML を共有の出所** にする: `key_facts` は回答正確性（必要事実の網羅）、
  `relevant_documents` は引用妥当性のチェックに転用。
- 将来 `src/eval/` が `runAgent` を golden cases で回し、**LLM-judge（Anthropic / claude）** で
  faithfulness（引用チャンクに根拠があり捏造なし）・answer-correctness・citation-precision をスコア。
- 本フェーズの fact_coverage は「**生成なしで測れる回答可能性プロキシ**」として、
  faithfulness 実装前の代替指標になる。

## エラー処理・テスト

- 未取り込み文書 → 欠落ファイル名列挙 + `eval ingest` 案内。
- 空 retrieve → メトリクス 0 でクラッシュしない。
- ゲート未達 → 非ゼロ終了 + 内訳。
- スモークテストは **共有 Postgres に触れない**（既知の「rag tests は共有DBを使う」問題を回避）:
  retrieve を注入したインメモリ経路で DB フリー。`corpus.py` の実取り込み経路のみ Layer 2 で検証。

## 受け入れ条件との対応

| Issue 受け入れ条件 | 本スペックでの達成 |
| --- | --- |
| ゴールデンセット + 検索/回答品質メトリクス | `golden/*.yaml` + `metrics.py`（recall@k/precision@k/MRR/nDCG + fact_coverage）。faithfulness は方針 + プロキシ。 |
| CI で回帰評価を実行 | Layer 1（毎PR スモーク）+ Layer 2（フルスタック実評価 + 閾値ゲート + ベースライン差分）。 |
| 埋め込み更新時の再インデックス/バージョニング | コレクション命名フック + ブルーグリーン方針 + ゲート結線（`reindex` は骨子）。 |

## 非ゴール（YAGNI）

- 回答生成ハーネス（`src/eval/`）の実装本体。
- LLM-judge の実装。
- `eval reindex` の完全実装（骨子のみ）。
- 大規模ゴールデン（初期はデモ8ケースを母体に厳選）。
