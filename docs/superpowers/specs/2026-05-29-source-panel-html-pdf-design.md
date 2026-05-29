# 一次資料パネルの強化：テーブル整形描画 + 元PDF表示

- 日付: 2026-05-29
- 対象: `src/components/sources/right-panel.tsx` を中心としたフロントエンド + 引用メタ伝播 + PDF配信経路

## 背景と課題

PDF → MinerU(pipeline backend) → `content_list.json` の正規化パイプラインで、テーブルは
HTML文字列(`<table>…</table>`)として `ParsedBlock.html` に格納される。
chunker はこれを `chunk.text` に「caption + 改行 + HTML文字列」として束ね、
DB(`chunks.text`)→ `citations.snippet` → `SourceSection.body` と運ばれる。

一次資料パネル(`right-panel.tsx:173`)は `body` を `whitespace-pre-wrap` の
プレーンテキストとして描画しているため、**テーブルが生HTMLタグのまま表示される**。

加えて、引用の真相源である **元PDFをパネル内で確認したい** が、現状 `Document.raw_path`
に実体は保存されているものの、それを返す経路が存在しない。

### 既存の好材料
- `Document.raw_path`(`rag/app/models.py:24`) に元PDFの実体パスがある。
- 各 chunk は `page_start` / `page_end` を持つ(`rag/app/models.py:36-37`)ため、
  引用箇所のページへ PDF をディープリンク(`#page=N`)できる。
- `chunks.block_type` で `"table"` 等の種別が判定できる(citation 化の段階で現状は落ちている)。
- Nextプロキシの認証パターンは `src/app/api/uploads/[id]/route.ts` が手本になる。
- rag への内部呼び出しは `ragFetch`(`src/lib/rag-client.ts`)で `x-internal-token` 付与済み。

## ゴール

1. 一次資料パネルのテーブルセクションを、実テーブルとして整形描画する（依存ゼロの自前パーサ）。
2. パネルに「構造化 ⇄ 元PDF」トグルを追加し、PDFタブではブラウザ標準iframeで
   元PDFを引用ページへジャンプ表示する。

非ゴール（YAGNI）:
- PDF.js 等の独自ビューア導入、ページ画像化、テキスト選択ハイライトの自前制御。
- テーブル以外のブロック（equation/image）の描画刷新（今回は対象外）。

## 設計

### A. 引用メタ情報の伝播（テーブル判定 & ページ・ジャンプの土台）

`block_type` と `page` を citation の最後まで運ぶ。

- `src/lib/agent/citations.ts`
  - `CitationInput` に `blockType: string`、`page: number` を追加。
  - `toSources()` で `SourceSection` に `blockType` / `page` を載せる。
- `src/lib/agent/tools.ts`(`:113`, `:141`)
  - 既に手元にある `c.blockType` / `c.pageStart` を `register()` に渡す。
- `src/lib/db/schema.ts` の `citations` テーブルに
  `blockType: text("block_type").notNull().default("text")` と
  `page: integer("page").notNull().default(0)` を追加 → **Drizzle マイグレーション**を生成。
- citation 行の挿入箇所で新カラムを保存し、`src/lib/threads.ts`(`sourcesFromCitations`,
  現状 `:143`)で `SourceSection` に反映。
- `src/lib/types.ts` の `SourceSection` に `blockType?: string`、`page?: number` を追加。
- **後方互換フォールバック**: `blockType` が無い既存データ向けに、
  `body.trimStart().startsWith("<table")` のヒューリスティックでテーブル判定も併用する。

### B. テーブルHTMLの整形描画（自前パーサ）

`right-panel.tsx` のセクション本文描画を分岐させ、テーブルのときだけ整形描画する。

- 新規ユニット `src/components/sources/html-table.tsx`（単一責務・独立テスト可能）。
  - 入力: テーブルHTML文字列。出力: React要素。
  - **許可リスト方式の自前パーサ**: ブラウザの `DOMParser` で解析し、
    許可タグ(`table/thead/tbody/tr/td/th/p/br/strong/b/em/i/u/a/span`)と
    許可属性(`colspan/rowspan`、`a` の `href` のみ・`http(s)`/相対のみ)だけを
    React要素へ変換する。**`dangerouslySetInnerHTML` は使わない**ため、
    `<script>`/イベントハンドラ/`javascript:` 等は構造的に混入しない。
  - クライアント専用描画（`right-panel.tsx` は `"use client"`）。SSR時は
    `DOMParser` 非存在のため、未パース時はプレーンテキストにフォールバック
    （`useEffect`/マウント後パース、または `typeof window` ガード）。
  - スタイル: `overflow-x-auto` のラッパ + Tailwind で枠線・ヘッダ強調・
    ゼブラ・セルパディングを付与。`colspan/rowspan` とセル内 `<br>`/`<p>` を保持。
- `right-panel.tsx:172-174` のセクション描画を
  「テーブルなら `<HtmlTable>`、それ以外は従来の `whitespace-pre-wrap`」に分岐。
  - caption（HTML前の先頭行テキスト）が body に含まれる場合は分離して見出し上に表示。

### C. 元PDFの配信経路

- バックエンド: `rag/app/routers/documents.py` に
  `GET /documents/{document_id}/raw?owner_user_id=...` を追加。
  - `require_internal_token` 依存、`Document` の所有者一致チェック（不一致は404）。
  - `FileResponse(raw_path, media_type=doc.mime, content_disposition_type="inline")`。
    ファイル不在時は404。
- Nextプロキシ: `src/app/api/documents/[id]/raw/route.ts`（新規）。
  - `getSessionClaims()` で認証（`uploads/[id]/route.ts` と同型）。
  - `ragFetch('/documents/{id}/raw?owner_user_id={sub}')` の本体をストリーム中継。
  - レスポンスヘッダ: `Content-Type: application/pdf`、`Content-Disposition: inline`。
  - 失敗時は 404 JSON。

### D. パネルUI：構造化 ⇄ PDF トグル

- `right-panel.tsx` に表示モード state（`"structured" | "pdf"`、既定 `"structured"`）を追加。
- ヘッダ（タブ群の近辺）に2択トグル（`構造化` / `元PDF`）を配置。
  - PDF表示が不可能なとき（`active.type` がPDFでない/`document mime` が `application/pdf`
    でない等）はトグルを出さず、従来通り構造化のみ。
- PDFタブ:
  - `<iframe src={`/api/documents/${active.id}/raw#page=${page}`} className="h-full w-full" />`。
  - `page` は現在ハイライト中セクションの `page`（無ければ先頭セクション、既定1）。
  - `highlightSectionId` 変更時、`page` を再計算して iframe の `src` を更新（ページジャンプ）。
- 既存の `open-source` ボタンの遷移先も、この `/api/documents/{id}/raw` に揃える。

## データフロー（after）

```
PDF → MinerU → ParsedBlock(table.html) → chunker(chunk.text=HTML, block_type="table", page)
  → chunks(DB: text, block_type, page_start)
  → retrieve → RetrievedChunk(blockType, pageStart)
  → CitationRegistry(register: blockType, page)
  → citations(DB: snippet, block_type, page)
  → SourceSection(body, blockType, page)
  → right-panel:
       blockType==="table" → <HtmlTable>（自前パーサで整形描画）
       PDFタブ → <iframe src="/api/documents/{id}/raw#page={page}">
```

## テスト

- `src/components/sources/html-table` の unit テスト:
  - 基本テーブル、`colspan`/`rowspan`、セル内 `<br>`/`<p>`/`<a>` の保持。
  - 危険な入力（`<script>`、`onclick`、`javascript:` href）が除去されること。
- citations メタ伝播の unit テスト（`blockType`/`page` が `SourceSection` まで届く）。
- Nextプロキシ route の認証・中継（既存 `uploads` route のテストパターン踏襲）。
- e2e（Playwright）:
  - パネルでテーブルが `<table>` として描画される。
  - 「元PDF」タブで iframe が `/api/documents/{id}/raw#page=N` を指す。

## リスクと留意点

- 既存 citation 行には `block_type`/`page` が無い → カラムは default 付き + フロントの
  HTMLヒューリスティックで後方互換を担保。
- ブラウザ標準PDFビューアは環境差がある（`#page` 非対応ブラウザもある）が、
  依存ゼロ・最小実装を優先。将来 PDF.js への差し替え余地は残す。
- 自前パーサは MinerU 由来の限定タグ集合前提。想定外タグはテキスト化して握りつぶす。
