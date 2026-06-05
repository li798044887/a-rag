# RAG 評価：公開データセット実行手順と運用方針

ハーネス本体の設計・構成は [`rag-eval-harness.md`](./rag-eval-harness.md) を参照。
本ノートは、公開ベンチマークを使って検索品質評価を回す手順と、今後追加する
データセットの選定方針をまとめる。

## 1. 現行の標準 suite

標準 suite は二段構え。

- `beir_scifact`: 公開ベンチマーク。検索評価の再現性・対外説明用。
- `agentic_rag_demo`: repo 管理の専用 golden。表・図面・複数文書照合など、プロダクト固有の難所確認用。

既定 suite は `beir_scifact`。

- 設定: `rag/eval/suites/beir_scifact/suite.yaml`
- 元データ: BEIR SciFact (`corpus.jsonl` / `queries.jsonl` / `qrels/test.tsv`)
- 生成先:
  - corpus text: `artifacts/eval-assets/beir_scifact/`
  - generated golden: `artifacts/rag-eval/beir_scifact/golden.yaml`
  - report: `artifacts/rag-eval/beir_scifact/eval-report.{json,md}`

repo には公開データセット本体をコミットしない。CI またはローカル実行時に BEIR の
公式 zip を取得し、text 資産と golden を生成する。

`agentic_rag_demo` は以下を repo 管理する。

- `rag/eval/suites/agentic_rag_demo/golden.yaml`
- `rag/eval/suites/agentic_rag_demo/baselines/bge-m3__bge.json`
- `rag/eval/assets/agentic_rag_demo/*.pdf`

## 2. ローカル実行

```bash
docker compose --profile worker up -d --build rag

docker compose exec -T rag uv run python -m eval prepare-beir \
  --suite beir_scifact \
  --assets-dir /data/eval-assets/beir_scifact \
  --golden-out /data/eval-reports/beir_scifact/golden.yaml

docker compose exec -T rag uv run python -m eval ingest \
  --suite beir_scifact \
  --golden /data/eval-reports/beir_scifact/golden.yaml \
  --files-dir /data/eval-assets/beir_scifact

docker compose exec -T rag uv run python -m eval run \
  --suite beir_scifact \
  --golden /data/eval-reports/beir_scifact/golden.yaml \
  --gate \
  --out /data/eval-reports/beir_scifact/eval-report.json
```

専用 golden を回す場合:

```bash
docker compose --profile worker up -d --build rag
docker compose exec -T rag uv run python -m eval ingest --suite agentic_rag_demo
docker compose exec -T rag uv run python -m eval run \
  --suite agentic_rag_demo \
  --gate \
  --out /data/eval-reports/agentic_rag_demo/eval-report.json
```

小さく試す場合:

```bash
docker compose exec -T rag uv run python -m eval prepare-beir \
  --suite beir_scifact --query-limit 10 --corpus-limit 200
```

`corpus-limit: 0` は full corpus を意味する。夜間評価は full corpus、手元確認は
小さい subset で回すのがよい。

## 3. CI

`.github/workflows/rag-eval-full.yml` は `workflow_dispatch` と nightly schedule で動く。
セルフホスト runner (`self-hosted`, `Windows`, `rag`) が必要。

手動実行 input:

- `suite`: 既定 `beir_scifact`
- `query_limit`: 既定 `100`
- `corpus_limit`: 既定 `0`（full corpus）

CI は以下を行う。

1. `artifacts/rag-eval/<suite>` と `artifacts/eval-assets/<suite>` を作成
2. `prepare-beir` で公開データセットから generated golden を作る
3. generated golden の文書を RAG に ingest
4. `eval run --gate` を実行
5. Markdown レポートを GitHub Step Summary に表示
6. JSON / Markdown レポートを artifact として保存

## 4. 判断基準

公開 retrieval ベンチでは `key_facts` を使わないため、主指標は以下。

| 指標 | 意味 |
| --- | --- |
| `recall@k` | 正解文書を上位 k に取れたか |
| `MRR` | 最初の正解が何位に来たか |
| `nDCG@k` | 正解が上位に来るほど高い順位品質 |
| `precision@k` | 上位 k 件中の正解率 |

`fact_coverage` は key facts が空なら 1.0 になる。公開 BEIR suite では gate に使わず、
自社・業務 golden を追加する時だけ使う。

## 5. 推奨公開データセット

優先順:

1. **BEIR SciFact**
   - 小さめで CI に載せやすい。
   - corpus / queries / qrels が揃っており、現行ハーネスと相性がよい。
2. **BEIR NFCorpus**
   - corpus が約 3.6K と小さく、関連文書が多め。
   - recall と nDCG の挙動を見るのに使いやすい。
3. **MIRACL ja / zh**
   - 日本語・中国語検索を評価したい場合の本命。
   - corpus が大きいので nightly または専用 runner 向け。
4. **MS MARCO Passage**
   - passage ranking の定番。
   - 大規模なので、full corpus 評価は重い。subset や reranker 評価向き。

RAG の最終回答品質はこの検索評価だけでは保証しない。回答生成の
faithfulness / answer correctness / citation precision は別レイヤーとして追加する。
