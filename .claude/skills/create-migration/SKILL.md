---
name: create-migration
description: ARag の DB スキーマ変更から Drizzle マイグレーション生成・ローカル適用までを安全な手順で行う。テーブル/カラム追加や schema.ts 変更時に使う。
disable-model-invocation: true
---

# create-migration

ARag の Postgres スキーマを Drizzle で変更し、マイグレーションを生成・適用するためのスキル。
ローカル Postgres は **host 5433**（`docker-compose.override.yml` の上書き。別プロジェクト回避のため）。
`drizzle.config.ts` のデフォルトは 5432 なので、**適用時は必ず 5433 の DSN を渡す**こと。

## 前提の確認
- スキーマ定義: `src/lib/db/schema.ts`
- 出力先: `./drizzle`（連番 SQL: `0000_*.sql` … 既存最新は確認してから）
- パッケージマネージャ: **pnpm** 固定
- ローカル DB が起動しているか: `docker compose ps postgres`

## 手順

1. **スキーマを編集する**
   - `src/lib/db/schema.ts` を変更（テーブル/カラム/インデックス等）。

2. **マイグレーション SQL を生成する**（DB 接続不要・スキーマ読むだけ）
   ```bash
   pnpm drizzle-kit generate
   ```
   - `./drizzle/NNNN_*.sql` が新規生成される。

3. **生成 SQL をレビューする**
   - 破壊的変更（DROP / NOT NULL 追加 / 型変更）が含まれていないか確認。
   - 既存データに影響する場合はデフォルト値やバックフィル手順を検討。

4. **ローカル DB に適用する**（必ず 5433 の DSN を明示）
   ```bash
   DATABASE_URL=postgres://arag:arag@localhost:5433/arag pnpm drizzle-kit migrate
   ```

5. **rag 側スキーマとの整合を確認する**
   - RAG サービス（`rag/`）は **alembic** で別管理（`rag/alembic`）。
   - 今回の変更が rag が読む/書くテーブルに及ぶ場合は、対応する alembic リビジョンも作る必要がある。
   - rag を変更した場合はイメージ再ビルドが必要: `docker compose up -d --build rag`。

6. **検証する**
   - 型/起動確認とテスト: `pnpm test`（DB 層に `src/lib/db/db.test.ts` あり）。

## 守ること
- `.env.local` は直接編集しない（フックでブロックされる）。DSN はコマンドにインラインで渡す。
- ポートは必ず **5433**。5432 だと別プロジェクトの DB を触る恐れがある。
- 生成 SQL は手で書き換えず、原則 `schema.ts` を直して再生成する。
