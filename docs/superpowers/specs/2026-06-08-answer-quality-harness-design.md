# 回答品質評価ハーネス 設計書（#4 Phase1）

- 日付: 2026-06-08
- 対象 issue: `was865/a-rag#4`（回答品質ハーネス）
- ステータス: 設計承認済み（実装計画は別途 writing-plans で作成）

## 1. 目的とスコープ

検索だけでなく **エージェント最終回答の品質** を回帰検知する決定論的ハーネスを作る。
既存の Python eval（`rag/eval`）は文書レベル recall@k / fact_coverage を測るが、
`runAgent`（TS）が生成する**最終回答テキストと引用**は評価対象外だった。本ハーネスは
そこを埋める。

### Phase 設計（段階的）
- **Phase1（本設計）**: LLM judge を使わない**決定的指標**を CI ゲート化する。
  - citation precision / citation recall（引用文書 vs golden の関連文書）
  - answer fact coverage（最終回答が golden の key_facts を含むか）
- **Phase2（将来・本設計対象外）**: faithfulness / answer correctness の **LLM judge**
  （手動 → 将来 nightly）。本設計では作らない。

### 非目標（YAGNI）
- LLM judge、ランタイム groundedness（`verify.ts`）の指標化、複数 suite 対応、
  baseline 差分の自動化、`--runs N` 平均（フックだけ残し実装しない）。

## 2. 確定した設計判断

| # | 論点 | 決定 |
|---|---|---|
| Q1 | 目的 | 段階的。Phase1=決定的指標を CI ゲート、LLM judge は Phase2。 |
| Q2 | 配置 | **TS 側 in-process**。`runAgent` を直呼びし `done` イベントを収集。HTTP 不使用（rag への HTTP は runAgent 内部のみ）。 |
| Q3 | データセット | **A**: Phase1 は `agentic_rag_demo` の golden を再利用（single source）。公開ベンチ（JEMHopQA 等）は Phase2。 |
| — | 実行配線 | **独立ランナー + 専用 workflow**。`pnpm test` には載せない。Python eval（`run --gate --out *.json`）と同型。 |
| — | bootstrap | **Vite-SSR ローダ技法**（`@/` エイリアス解決 + `.env.local` 読込）。observatory の `server.mts` と同手法（ツール本体には非依存）。 |
| — | 複数モデル | matrix（モデルごとに JSON レポート）。`runAgent` の `RunInput.modelId` をループ。 |
| — | gate ポリシー | **主モデルのみ gate**、他は参考（informational）。 |
| — | 非決定性 | 本番 `run.ts` は改変しない。閾値マージンで吸収。 |

## 3. アーキテクチャ

### パイプライン（Python eval と同型）
1. **ingest（既存 Python 再利用）**: `python -m eval ingest --suite agentic_rag_demo`。
   owner `__eval_agentic_rag_demo__` にコーパス投入。新規作成しない。
2. **answer-eval ランナー（新規 TS）**: `golden.yaml` を読み、**モデル matrix × 各 case**
   で `runAgent({ modelId, ownerUserId: golden owner, query })` を回す → 最終回答テキスト
   ＋引用文書 ID（`done` イベント）を収集 → 指標算出 → **モデルごとに JSON 出力** →
   **主モデルのみ gate**（終了コード）。

### ファイル構成
```
tools/answer-eval/
  run.mts          # エントリ: 引数解析 + Vite-SSR bootstrap + 統括 + 終了コード
  harness.ts       # 1 case 実行 + 集計（runAgent を依存注入で受ける）
  metrics.ts       # 指標関数（純粋・単体テスト対象）
  golden.ts        # golden.yaml / answer.yaml ロード + 型
  report.ts        # JSON レポート形 + gate 判定
  metrics.test.ts  # 既定 pnpm test で回る単体テスト（fixture、スタック不要）
  harness.test.ts  # fake runAgent を注入したロジック検証
```
- **golden 再利用**: `rag/eval/suites/agentic_rag_demo/golden.yaml`（queries / key_facts /
  relevant_documents の single source。Python eval と共有）。
- **answer-eval 専用設定**: `rag/eval/suites/agentic_rag_demo/answer.yaml`（新規・後述）。
- **出力**: `--out <dir>` で指定したディレクトリに `<dir>/agentic_rag_demo__<model>.json`
  （CI では `artifacts/answer-eval`。ローカル既定は `eval-reports/answer`）。
- **追加依存**: `yaml`（golden/answer 読込）。
- **新 workflow**: `.github/workflows/answer-eval.yml`。

### bootstrap（Vite-SSR ローダ技法）
`run.mts` は `vite` の `createServer`（SSR）と `loadEnv` で `@/` エイリアス解決と
`.env.local` 読込を行い `runAgent` を import する（observatory `server.mts` と同手法）。
これにより素の `node` 実行でも本番と同一の `runAgent` を呼べる。

## 4. 指標定義（すべて LLM 不要）

各 case ごとに3指標 → モデル単位で平均。引用文書の同定は `done` の `citationMap`
（回答が実際に参照した番号 → `documentId`）と `sources`（`documentTitle`）を使い、
golden の `relevant_documents`（PDF ファイル名）と **documentTitle で突合**
（厳密一致は実装計画で検証）。

- **citation recall** = |引用文書 ∩ relevant| / |relevant|
- **citation precision** = |引用文書 ∩ relevant| / |引用文書|（引用ゼロは 0）
- **answer fact coverage** = 充足した key_fact グループ数 / 全グループ数
  - 各グループは `any:` の表記揺れのいずれかが**最終回答テキストに含まれれば充足**。
  - **Python `fact_coverage` と同一の部分一致セマンティクス**（正規化なしの素の
    substring。golden が半角/全角を両方列挙しているのはこの前提のため）。マッチ対象は
    `answer-delta` を連結した最終回答全文。

**エッジケース**
- API キー欠如のモデル（`resolveModels` が `ok:false`）→ matrix から除外して warning。
- 引用ゼロの case → citation precision/recall = 0。
- relevant が空の case は本 golden に無いため考慮外。

## 5. レポート / gate / 非決定性

### レポート JSON（モデルごと1ファイル）
```jsonc
{
  "suite": "agentic_rag_demo",
  "model": "gpt-4.1",
  "rewrite_model": "gpt-4.1-mini",
  "owner_user_id": "__eval_agentic_rag_demo__",
  "generated_at": "2026-06-08T...Z",
  "gate": true,                          // 主モデルか
  "thresholds": { "citation_recall": .., "citation_precision": .., "answer_fact_coverage": .. },
  "metrics": { "citation_recall": .., "citation_precision": .., "answer_fact_coverage": .. },
  "passed": true,                        // gate モデルのみ意味を持つ
  "cases": [
    { "id": "case1-cross-page-table",
      "citation_recall": 1.0, "citation_precision": 1.0, "answer_fact_coverage": 1.0,
      "cited_documents": ["04-...pdf"], "relevant_documents": ["04-...pdf"],
      "fact_groups": [ { "any": ["N9"], "matched": true } ],
      "answer_excerpt": "...", "duration_ms": 12345, "tokens": 4321 }
  ]
}
```

### gate セマンティクス
- **主モデルのレポートだけ** `passed` を閾値判定し、割れたらランナーが**非ゼロ終了**。
  他モデルは `gate:false`・レポート出力のみで終了コードに影響しない。

### モデル matrix / 閾値設定（`answer.yaml`）
Python の golden を汚さないため、answer-eval 専用設定を sibling ファイルに置く。
```yaml
primary: gpt-4.1                    # gate 対象 = 本番既定
models:                            # キーが無いモデルは自動 skip + warning
  - gpt-4.1
  - gpt-4o                         # 旧既定（切替の比較対象）
  - deepseek-flash
  - deepseek-v4-pro
thresholds:                        # 初回実測 - マージンで確定（暫定値・要キャリブレーション）
  citation_recall: 0.80
  citation_precision: 0.75
  answer_fact_coverage: 0.80
```

### 非決定性
- 本番 `run.ts` の温度は未設定（既定・非決定的）。**eval のために本番を改変しない**。
- 既定は 1 case 1 回。非決定性は**閾値マージン**で吸収（commit `1354365` の Python
  baseline 引き上げと同流儀。初回実測から余裕を引いて設定）。
- flake が出たら `--runs N`（N 回平均）を後付けできるよう集計を設計（Phase1 では未実装）。

## 6. CI workflow

`.github/workflows/answer-eval.yml`（`rag-eval-full.yml` と同型）
- トリガ: `workflow_dispatch`（inputs: `primary` 上書き等）＋ `schedule`（nightly）。
- `runs-on: [self-hosted, Windows, rag, gpu]` / `shell: powershell` /
  `MINERU_MODEL_SOURCE: modelscope`。
- ステップ:
  1. checkout → レポートディレクトリ作成
  2. スタック起動: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile worker up -d --build rag`
  3. ingest: `docker compose ... exec -T rag uv run python -m eval ingest --suite agentic_rag_demo`
  4. `pnpm install`（runner host）
  5. answer-eval 実行: `pnpm answer-eval --suite agentic_rag_demo --gate --out artifacts/answer-eval`（= `node tools/answer-eval/run.mts`）。終了コードで gate。
  6. レポート summary 出力 ＋ `actions/upload-artifact` で `*.json` 公開。

**統合ポイント**: ハーネスは runner host の Node で動き、`runAgent` → rag-client が
**HTTP で rag に到達**する。host から rag の公開ポートへ `RAG_SERVICE_URL` を向け、
`RAG_INTERNAL_TOKEN` と各 API キー（`OPENAI_API_KEY` / `DEEPSEEK_API_KEY`、secrets）を
env で渡す。rag の host 公開ポートの厳密値は実装計画で確認。

## 7. ハーネス自体のテスト

`runAgent` を**依存注入**にし、ロジックをスタック/API キー無しで単体テスト可能にする
（observatory の `observe.test.ts` / `replay.test.ts` と同方針）。
- `metrics.test.ts`（既定 `pnpm test`・スタック不要）: citation precision/recall
  （完全/部分一致・引用ゼロ=0・無関係引用の penalize）、answer fact coverage
  （半角/全角揺れ・部分充足・Python と同一 substring）。
- `harness.test.ts`: golden/answer ロード、**fake runAgent**（canned `done` を yield）を
  注入して 1 case 実行→指標→集計→gate 判定、キー欠如モデルの skip + warning。
- 実 `runAgent` を使う統合確認は answer-eval 実行そのもの（CI）が担う。別途の重い統合
  テストは作らない。

## 8. 既存コード事実（実装の前提）

- `src/lib/agent/run.ts`: `export async function* runAgent(input: RunInput): AsyncGenerator<AgentEvent>`。
  `RunInput.modelId` でモデル指定可。`done` イベントに `citationMap` / `sourceIds` / `sources`。
- `src/lib/agent/models.ts`: `resolveModels(modelId)` が `deepseek-*` / `claude-*` /
  `gpt-*` を解決。キー欠如は `ok:false`。本番既定は `gpt-4.1`（rewrite `gpt-4.1-mini`）。
- `src/lib/agent/citations.ts`: `CitationRegistry`。引用は `documentId` + `documentTitle`。
- `tools/observatory/server.mts`: Vite-SSR で `runAgent` を in-process 起動する実証例。
- `rag/eval/suites/agentic_rag_demo/golden.yaml`: queries + key_facts（`any:`）+
  relevant_documents（7 文書, owner `__eval_agentic_rag_demo__`）。

## 9. 未確定（実装計画で詰める）
- documentTitle ↔ golden ファイル名の厳密な突合（拡張子・正規化の有無）。
- rag の host 公開ポート（`RAG_SERVICE_URL` の値）。
- 閾値の確定値（初回キャリブレーション run 後に `answer.yaml` を更新）。
- `pnpm answer-eval` スクリプトの引数仕様の最終形。
