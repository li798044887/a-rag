# RAG 検索品質 評価ハーネス

検索品質を文書レベル recall@k / 事実グラウンディング(fact_coverage)で回帰評価する。

## 構成
- `suites/<suite>/suite.yaml` … 公開データセットアダプタ設定
- `suites/<suite>/golden.yaml` … repo 管理の専用 golden（業務・デモ・回帰用）
- `metrics.py` … 純関数メトリクス / `runner.py` … 実行 / `report.py` … レポート・ゲート
- `beir.py` … BEIR 形式（corpus / queries / qrels）から golden とテキスト資産を生成
- `corpus.py` … 取り込み・解決 / `__main__.py` … CLI

## ローカル実行（フルスタック必須）
rag はベイク済みイメージのため、eval コード変更後は必ず `--build` で再ビルドする。
公開データセットは compose の bind mount（`/data/eval-assets`, `/data/eval-reports`,
`/data/eval-cache`）へ実行時に準備する。
```bash
docker compose --profile worker up -d --build rag
docker compose exec -T rag uv run python -m eval prepare-beir --suite beir_scifact
docker compose exec -T rag uv run python -m eval ingest \
  --golden /data/eval-reports/beir_scifact/golden.yaml \
  --files-dir /data/eval-assets/beir_scifact
docker compose exec -T rag uv run python -m eval run \
  --golden /data/eval-reports/beir_scifact/golden.yaml \
  --gate --out /data/eval-reports/beir_scifact/eval-report.json
```

repo 管理の専用 golden を回す場合:

```bash
docker compose --profile worker up -d --build rag
docker compose exec -T rag uv run python -m eval ingest --suite agentic_rag_demo
docker compose exec -T rag uv run python -m eval run \
  --suite agentic_rag_demo \
  --gate --out /data/eval-reports/agentic_rag_demo/eval-report.json
```

## ベースライン更新
意図的に基準を更新する時のみ `--out` の結果を
`suites/<suite>/baselines/<embedder>__<reranker>.json` にコピーしてコミットする。

## 埋め込みモデル更新（ブルーグリーン）
1. 新モデルを設定 → コレクション名 `arag_chunks__<model>` が自動で変わる
2. 全チャンクを新コレクションへ再埋め込み
3. `eval run --gate` を新コレクションで実行し品質ゲート通過を確認
4. 通過時のみサーブ切替、旧コレクション drop（未通過ならロールバック）
