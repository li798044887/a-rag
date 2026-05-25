# ARag — Agentic RAG

社内ナレッジ（議事録・Wiki・Slack・DB）を横断するエージェント型 RAG アシスタントの
Next.js 実装。Claude Design で設計された HTML/CSS/JS プロトタイプを、保守性・再利用性・
拡張性を備えた最新の Next.js（App Router）+ Tailwind v4 のコンポーネント体系として再構築したもの。

## 技術スタック

- **Next.js 16** (App Router, Turbopack) / **React 19**
- **TypeScript** (strict)
- **Tailwind CSS v4**（CSS-first `@theme`、`.theme-dark` カスタムバリアント、デザイントークン）
- **next/font**（Plus Jakarta Sans + JetBrains Mono）
- **jose** — JWT 認証（HS256, httpOnly cookie, `proxy.ts` でルート保護）
- **AI SDK (`ai` + `@ai-sdk/anthropic`)** — 回答生成のストリーミング

## 起動

```bash
pnpm install
pnpm dev      # http://localhost:3000
```

ログイン画面で任意の認証情報を入力（デモ）すると JWT が発行されます。`.env.local` は任意：

```bash
cp .env.example .env.local
```

| 変数 | 役割 |
|---|---|
| `ARAG_JWT_SECRET` | JWT 署名鍵（本番では必須）。未設定時は開発用の固定値。 |
| `ANTHROPIC_API_KEY` | 設定すると `summarize` ステップが Claude で実回答を生成。未設定時はキュレート済みのサンプル回答をストリーミング再生。 |

## アーキテクチャ

```
src/
  app/
    layout.tsx              フォント・メタdata・テーマbootstrap
    page.tsx                <Workspace /> をマウント
    globals.css             Tailwind v4 デザインシステム（トークン/テーマ/keyframe）
    api/
      auth/{login,logout,me} JWT 発行・破棄・セッション確認
      chat/route.ts          エージェント実行を SSE でストリーム
      upload/route.ts        マルチパートアップロード → チャンクメタ
  proxy.ts                  保護APIのルートレベル認証（旧 middleware）
  components/
    auth/ chat/ sidebar/ sources/ modals/ uploads/ feedback/ workspace/
    icons.tsx               型付きラインアイコンライブラリ
  hooks/                    use-auth / use-agent / use-uploads / use-tweaks /
                            use-toasts / use-media-query
  lib/
    types.ts data.ts constants.ts utils.ts file-types.ts auth.ts
    agent/{run,retriever,steps}.ts   サーバ側オーケストレーション + 取得層
```

### エージェントの流れ

クライアント（`use-agent`）が `/api/chat` を叩き、サーバ（`lib/agent/run.ts`）が
`rewrite_query → vector_search → bm25_search → rerank → fetch_document → summarize`
を順に実行。各ステップと回答トークンを SSE で配信し、UI はツール実行カード＋
タイプライタ回答＋引用ハイライトとして再構成します。

取得層（`lib/agent/retriever.ts`）はシード資料に対する語彙オーバーラップ検索の
**差し替え可能なインターフェース**で、本番では pgvector / Qdrant 等に置き換えられます。

## スクリプト

```bash
pnpm dev          開発サーバ
pnpm build        本番ビルド
pnpm start        本番起動
pnpm lint         ESLint
```
