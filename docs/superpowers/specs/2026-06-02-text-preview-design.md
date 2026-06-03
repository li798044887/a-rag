# テキスト系ファイルの整形プレビュー設計

- 日付: 2026-06-02
- 対象: アップロード文書モーダル（`src/components/documents/documents-modal.tsx`）

## 背景・課題

アップロード文書モーダルのタブは `原本 / (PDFのみ レイアウト・Span) / 解析テキスト / HTML整形 / 画像` で構成されている。

- `md` / `json` / `txt` などのテキスト系ファイルは `原本` タブで「ブラウザでプレビューできません」フォールバックに落ちる（PDF・画像・表計算・Office 変換のいずれにも該当しないため）。
- `HTML整形` タブはチャンクを再構成して `RenderedSectionBody` で描画するが、Markdown 記法（見出し `#`、リスト、コードフェンス、強調など）は素のテキストのまま表示され、読みづらい。

テキスト系ファイルは抽出画像を持たないため、PDF 向けの `レイアウト/Span/画像` タブや冗長な `HTML整形` は不要。シンプルな3タブモデルへ切り替える。

## 方針

テキスト系ファイル（拡張子で判定）を選択したときは、タブを次の3つに切り替える。

1. **原本** — 原始ファイルの中身をそのまま等幅表示（生の md/json/txt 文字列）
2. **解析テキスト** — DB の索引済みチャンクを反映（既存の `text` タブを流用）
3. **整形表示** — 種別ごとに見やすくレンダリング（新規タブ）

`原本 → DBテキスト → 整形` という素直な流れ。整形表示は**原本（原始ファイル）を元に描画**する（解析チャンクの再構成ではない）。

テキスト系でないファイルは従来の挙動を完全に維持する。

## コンポーネント設計

### 1. ファイル分類（`src/lib/file-types.ts`）

拡張子ベースの分類関数を追加（既存の `isSpreadsheet` / `isConvertibleToPdf` と同じ流儀）。

```
export type TextPreviewKind = "markdown" | "json" | "jsonl" | "text";
export function getTextPreviewKind(filename: string): TextPreviewKind | null;
```

- `markdown`: `md`, `markdown`
- `json`: `json`
- `jsonl`: `jsonl`, `ndjson`
- `text`: `txt`, `log`, `csv`, `tsv`, `yaml`, `yml`, `xml`（フォールバックのテキスト系）
- `null`: 上記いずれでもない（＝従来の挙動）

判定は拡張子（小文字）で行う。表計算（xlsx/xls/ods）は `isSpreadsheet` が優先で扱うため対象外。csv は表計算ではなくテキスト系（`text`）として扱う。

### 2. タブ構成（`documents-modal.tsx`）

`Tab` 型に整形表示用の id `"rich"` を追加。

- `getTextPreviewKind(filename)` が非 null のとき、タブ配列を
  `[["pdf", "原本"], ["text", "解析テキスト"], ["rich", "整形表示"]]` にする。
  `レイアウト/Span/HTML整形/画像` は出さない。
- それ以外は現状のタブ配列を維持。
- 文書選択時（`selectDoc`）のデフォルトタブ: テキスト系なら `"rich"`、それ以外は現状ロジック（previewable→`"pdf"` / 否→`"text"`）。

タブ id `"pdf"` は内部キーであり「原本（ネイティブ原本）」スロットを表す。ラベルは従来どおり動的（テキスト系では `原本`）。

### 3. 原本テキストの取得

テキスト系文書を選択したら、モーダル側 effect で `/api/documents/[id]/raw` を `fetch().text()` で取得し state に保持する。`原本` タブと `整形表示` タブで共有し二重取得を避ける。

- 取得状態: `loading | ready | error`。
- サイズ上限: 2MB。超過時は冒頭のみ表示し、「全文は原本をダウンロード」注記を出す。
- `selectedId` 変更時にリセット・再取得（PDF プレビュー等と同じく `cancelled` フラグで競合制御）。

### 4. 整形表示のレンダリング（新規コンポーネント）

コンポーネントは `src/components/documents/` にコロケーションし、`new-component` 規約に沿って Storybook ストーリーを併設する。

**`MarkdownView`**（`markdown-view.tsx`）
- `react-markdown` + `remark-gfm`（表・タスクリスト・取消線）+ `remark-math` + `rehype-katex`（katex は既存依存）。
- `components` マッピングで 見出し / 段落 / リスト / インラインコード / コードブロック / 表 / リンク / 画像 を ARag のデザイントークンに合わせて描画する。
  - 画像は既存 `SectionImage`（`rendered-section-body.tsx`）を再利用。
  - リンクは `target="_blank" rel="noopener noreferrer"`。
  - コードブロックは等幅・背景付きブロック（シンタックスハイライトは初期スコープ外）。
- **セキュリティ**: `rehype-raw` は導入しない。アップロード文書中の生 HTML を実行しない（XSS 回避）。raw HTML はテキストとして無害化される react-markdown 既定動作に従う。

**`JsonView`**（`json-view.tsx`）
- `JSON.parse` → `JSON.stringify(value, null, 2)` で整形 → 軽量トークナイザでキー / 文字列 / 数値 / 真偽 / null を色分け（依存ゼロの自前実装、約30行）。
- パース失敗時は `PlainTextView` にフォールバックし、「JSON として解析できませんでした」注記を添える。
- 折りたたみツリーは初期スコープ外（YAGNI、必要なら将来拡張）。

**`JsonlView`**（`json-view.tsx` 内 or 併置）
- 原文を行で分割し、空行を除いた各行を `JsonView` ブロックとして連番付きで描画。
- パース不能行は生テキストで表示しエラーを示す。

**`PlainTextView`**（`plain-text-view.tsx`）
- 等幅・`whitespace-pre-wrap` で本文を表示。`整形表示`（kind=`text`）と `原本` タブの双方で使用。

`整形表示` タブは kind により分岐:
`markdown → MarkdownView` / `json → JsonView` / `jsonl → JsonlView` / `text → PlainTextView`。
`原本` タブ（テキスト系）は常に `PlainTextView`（生文字列）。

### 5. 依存追加（pnpm）

`react-markdown` / `remark-gfm` / `remark-math` / `rehype-katex` を追加。npm はオンライン入手可。`packageManager` による pnpm 固定方針に従う。

## エラー・境界処理

- raw 取得失敗 → エラーメッセージ＋原本ダウンロード導線。
- 大容量（>2MB）→ 冒頭 truncate＋「全文はダウンロード」注記。
- 空ファイル / 空内容 → 「表示できる内容がありません」。
- JSON パース失敗 → プレーンテキストへフォールバック＋注記。

## テスト

- `getTextPreviewKind` の単体テスト（各拡張子 → kind、未対応 → null、大文字混在）。
- JSON シンタックスハイライタ・jsonl 行分割の単体テスト。
- 各 View の Storybook ストーリー（md / json / jsonl / txt のサンプル）。
- Markdown 描画スモークテスト（vitest browser; 見出し・リスト・表・コードが描画されること）。

## スコープ外（YAGNI）

- JSON / コードブロックの折りたたみツリー・行番号。
- コードブロックの言語別シンタックスハイライト。
- csv の表グリッド描画（テキストとして扱う。表計算は既存 `SpreadsheetPreview` が担当）。
- 生 HTML（`rehype-raw`）の描画。
