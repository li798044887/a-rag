# 引き継ぎ: Python 決定論的多ホップ検索（テキスト PRF）実装フェーズ

> 別の Claude セッション（会話コンテキストなし）が実装を引き継ぐための自己完結ハンドオフ。
> 2026-06-06 時点。応答・コミットは日本語、Conventional Commits（このリポジトリ規約）。

## 0. これは何か / ゴール

issue #13（検索品質ハーネス）の「hotpot 多ホップを回収し、ハーネスで測れる回帰ターゲットにする」を満たすため、**rag（Python）に LLM 不使用の決定論的テキスト PRF 多ホップ検索を実装**する。先行の TS エージェント側 bridge 実装は「評価ハーネスが測る単発 Python `retrieve_service` を通らない＝eval で測れない」ため revert 済み。

- **設計 spec**: `docs/superpowers/specs/2026-06-06-multihop-python-retrieval-design.md`
- **実装プラン**: `docs/superpowers/plans/2026-06-06-multihop-python-retrieval.md`（10 タスク・TDD・完全コード入り）

## 1. ブランチ状態

- **作業ブランチ: `feat/multihop-python-retrieval`**（main から分岐）。ここに spec/plan/本ハンドオフがコミット済み。**ここで実装する。**
- 旧 TS ブランチ `feat/multihop-bridge-retrieval`（多ホップを TS エージェントに実装したが eval で測れず revert 判断）は履歴として残置。**マージしない**。削除はユーザー許可制（未削除）。
- main はクリーン（多ホップ関連コード無し）。

## 2. ⚠️ 最重要: rag テストの実行方法（プランの誤りを訂正）

rag サービスは `docker-compose.yml` で `build: ./rag`・**ソースマウント無し**（焼き込みイメージ）。よって `rag/app/*.py` をホストで編集しても**コンテナ内のコードは変わらない**。

**→ rag のユニットテストは「ホスト」で uv を使って回す**（`rag/.venv` あり）:

```bash
cd rag && uv run pytest tests/test_multihop.py -q
```

- パスは `rag/` ディレクトリ相対（`tests/test_multihop.py`。プラン中の `rag/tests/...` ではなくホスト実行時は `tests/...`）。
- 共有 Postgres は**ホスト 5433**、Qdrant は **6333**（稼働中）。DB に触るテストはこれらが必要（本実装のユニットは monkeypatch でスタブ化のため大半は DB 非依存だが、conftest が起動時に DB を触る可能性あり）。
- 必要なら env: `DATABASE_URL=postgresql+psycopg://arag:arag@localhost:5433/arag`、`QDRANT_URL=http://localhost:6333`（ホストの rag 設定に既に入っている想定。落ちたら明示）。
- **プランに書いてある `docker compose exec -T rag uv run pytest …` は使わない**（焼き込みコードを叩くため新規ファイルが見えない）。どうしてもコンテナで動作確認したい場合のみ `docker compose up -d --build rag rag-worker` で再ビルドしてから。

TS テストは通常どおりホストで `pnpm test <path>`。**`pnpm test run` は禁止**（`run` が名前フィルタ化する。全件は `pnpm test`、単一は `pnpm test <path>`）。型は `pnpm exec tsc --noEmit`、lint は `pnpm lint`。

## 3. 実装の進め方

プランの **Task 1→10 を順に TDD で**実装（各タスクに失敗テスト→最小実装→通過→コミットの完全コードあり）。Task 間依存:
- T1 `_rrf_fuse` → T2 `_prf_query` → T3 `retrieve_multihop` → T4 `retrieve_multihop_stream`（すべて新規 `rag/app/retrieval/multihop.py`）
- T5 schema `multi_hop` → T6 ルータ分岐（T3/T4 に依存）
- T7 eval `--multi-hop`（T3 に依存）→ T8 CI yaml
- T9 TS rag-client 透過（独立）→ T10 全体ゲート

subagent-driven で回す場合も、各実装サブエージェントに **§2 のテスト実行方法（ホスト uv）** を必ず渡すこと（プランのコマンドをそのまま渡すと焼き込みコードを叩いて FAIL する）。

## 4. 環境状態（このセッションで構築済み・稼働中）

- フルスタック稼働中: `docker compose --profile worker up -d`（postgres/qdrant/redis/rag/rag-worker）。dev サーバも :3000。
- **Qdrant コレクションは統一済み**: rag・rag-worker を両方再ビルドし、両者とも `arag_chunks__bge-m3` を読み書き（このセッションで「worker だけ旧コードでコレクション分裂→retrieval 全0」を修復済み）。再分裂させないこと。詳細はメモリ `project_qdrant_collection_versioned`（落とし穴を追記済み）。
- 手動検証用フィクスチャ: owner `40d1602e-c96a-41f6-951c-8800043b8fe7` に `bridge-test/` 配下の文書（A_brown_lake / B_brown_county / distractor 5件）を取り込み済み。元ファイルは `~/Downloads/bridge-test/` と `/tmp/bridge-test/`。Brown County の人口は **9,508**。多ホップ手動確認に流用可。

## 5. GPU runner でしか出せないもの（ローカル/実装フェーズの範囲外）

- 実 recall@k / fact_coverage の改善測定（BGE-M3 + bge rerank + 全コーパス）。
- **multi-hop baseline JSON** `rag/eval/suites/hotpot_dev/baselines/bge-m3__bge__multihop.json`（`eval run --multi-hop --out ...` を self-hosted GPU で実走して生成・commit）。
- これらは `.github/workflows/rag-eval-full.yml`（Task 8 で hotpot multi-hop 比較実行を追加）を runner で回して得る。

## 6. 完了後

全 10 タスク完了 → 最終コードレビュー → `superpowers:finishing-a-development-branch`（PR 作成 or merge）。PR 本文末尾に `🤖 Generated with [Claude Code]` 等の規約に従う。コミット末尾は `Co-Authored-By: Claude ...`。

## 7. 設計の要点（レビュー判断の助け）

- **無条件発火**: `multi_hop=True` なら hop-1 が非空である限り常に hop-2（橋渡しは hop-1 が高品質ゆえ、スコア/件数の条件分岐では取りこぼす）。spec の「発火条件」節参照。
- **役割分担**: 推論駆動の多ホップは TS エージェントの自発ループ（IRCoT/agentic 相当・既存）が担い、Python は決定論的 recall 補強（PRF）に徹する。Python に LLM を入れない（rag のアーキ規約）。
- `_rrf_fuse` は hop-2 上位を `bridge_quota`(=2) で保護。`_prf_query` は hop-1 上位2チャンクの title+heading+本文先頭200字を元クエリへ連結。
