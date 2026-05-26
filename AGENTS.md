<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# プロジェクト規約

## 応答言語
このプロジェクトでのユーザーへの応答は **日本語** で行うこと。

## コミットメッセージ規約
[Conventional Commits](https://www.conventionalcommits.org/) 形式を採用し、**説明文は日本語**で記述する。

書式: `<type>: <日本語の説明>`

主な type:
- `feat:` 新機能
- `fix:` バグ修正
- `docs:` ドキュメントのみの変更
- `style:` 動作に影響しない変更（整形・空白など）
- `refactor:` バグ修正でも機能追加でもないコード変更
- `perf:` パフォーマンス改善
- `test:` テストの追加・修正
- `chore:` ビルド・補助ツール・依存関係などの変更

例:
- `feat: ワークスペースグリッドを追加`
- `fix: モバイルの横オーバーフローを修正`
- `refactor: 設定パネルを外観タブに統合`

破壊的変更がある場合は type の後に `!` を付ける（例: `feat!: 設定スキーマを変更`）。
