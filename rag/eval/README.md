# RAG 検索品質 評価ハーネス

検索品質を文書レベル recall@k / 事実グラウンディング(fact_coverage)で回帰評価する。

## 構成
- `golden/agentic_rag.yaml` … ゴールデンセット（質問・正解文書・期待事実）
- `metrics.py` … 純関数メトリクス / `runner.py` … 実行 / `report.py` … レポート・ゲート
- `corpus.py` … 取り込み・解決 / `__main__.py` … CLI

## ローカル実行（フルスタック必須）
rag はベイク済みイメージのため、eval コード変更後は必ず `--build` で再ビルドする。
デモPDFは compose の read-only マウント（`/data/demo-files`）から読む。
```bash
docker compose --profile worker up -d --build rag
docker compose exec -T rag uv run python -m eval ingest
docker compose exec -T rag uv run python -m eval run \
  --gate --baseline eval/baselines/agentic_rag.json --out eval-report.json
```

## ベースライン更新
意図的に基準を更新する時のみ `--out` の結果を `baselines/agentic_rag.json` にコピーしてコミットする。

## 埋め込みモデル更新（ブルーグリーン）
1. 新モデルを設定 → コレクション名 `arag_chunks__<model>` が自動で変わる
2. 全チャンクを新コレクションへ再埋め込み
3. `eval run --gate` を新コレクションで実行し品質ゲート通過を確認
4. 通過時のみサーブ切替、旧コレクション drop（未通過ならロールバック）
