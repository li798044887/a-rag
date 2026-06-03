# 一次資料パネルの「原本」表示を全形式へ標準化

- 日付: 2026-06-03
- 対象: web（`src/`）フロントエンド
- 種別: リファクタ + 機能拡張（UI）

## 背景 / 問題

一次資料パネル（`src/components/sources/right-panel.tsx`）の「原本」表示は
現状 `.pdf` 拡張子の資料でしか出ない。判定は `isPdf = /\.pdf$/i.test(title || path)`
で、`pdf` ビューモードのタブは PDF のときだけ現れる。PDF 以外（画像・Office・
表計算・テキスト）では `HTML整形` / `解析テキスト`（引用セクションの整形ビュー）
しか見られず、原本そのものを確認できない。

一方、文書一覧モーダル（`src/components/documents/documents-modal.tsx`）は
既に全形式の原本プレビューを実装している:

- PDF → iframe
- 画像 → `<img>`
- 表計算（xlsx/xls/ods）→ `<SpreadsheetPreview>`（SheetJS グリッド）
- Office（doc/docx/ppt/pptx/odt/ods/odp/rtf）→ `<RenderedPdfPreview>`（サーバ側 PDF 変換）
- テキスト（md/json/jsonl/txt 等）→ `<RawTextContent>`（生テキスト）
- 非対応 → `<UnsupportedPreview>`（原本ダウンロード導線）

原本描画ロジックが modal と panel に二重化している。これを **共有コンポーネントに
一本化**し、パネルでも全形式の原本を出せるよう標準化する。

## ゴール

- 一次資料パネルの「原本」タブを全形式で常設し、形式に応じた原本プレビューを出す。
- modal と panel で原本描画ロジックを共有する（重複の解消）。
- modal の既存表示・挙動は現状維持（リグレッションなし）。

## 非ゴール（YAGNI）

- MinerU 注釈ビュー（`layout` / `span` タブ）はパネルに持ち込まない（PDF 専用・modal 限定のまま）。
- 画像ギャラリー（`images` タブ）はパネルに持ち込まない。
- raw 取得 API・rag 側パース挙動の変更はしない。

## 設計

### 1. `file-types.ts` に拡張子ベースの判定 helper を追加

形式判定を拡張子ベースに統一するため、以下を追加する:

```ts
// 純正 PDF か（拡張子判定）
export function isPdf(name: string): boolean;
// ブラウザが直接表示できる画像か（png/jpg/jpeg/gif/webp/svg/bmp 等、拡張子判定）
export function isImage(name: string): boolean;
```

既存の `isConvertibleToPdf` / `isSpreadsheet` / `getTextPreviewKind` と並ぶ純粋関数。

### 2. 共有コンポーネント `src/components/documents/original-preview.tsx`（新規）

`documents-modal.tsx` 内にインライン定義されている次の3コンポーネントを
このファイルへ移設し、ディスパッチ本体 `OriginalPreview` を新設する。

- `UnsupportedPreview`（移設 + 拡張）
- `RenderedPdfPreview`（移設・変更なし）
- `RawTextContent`（移設・変更なし）

```ts
interface OriginalPreviewProps {
  docId: string;
  filename: string;
  /** PDF のときだけ #page=N へジャンプ。1-based。省略時はジャンプしない。 */
  pdfPage?: number;
  /** true で modal 風の角丸カード枠、false（既定）でフラッシュ表示（panel 用）。 */
  framed?: boolean;
  /** 指定時、非対応/原本欠落フォールバックに「引用テキストを表示」導線を出す。 */
  onShowParsed?: () => void;
}
```

ディスパッチ（優先順位は modal の `selectDoc` / 原本タブ分岐に合わせる）:

1. `isPdf(filename)` → iframe。`framed` 時は `p-3` + 角丸カード。`pdfPage` があれば
   `src` を `…/raw#page=${pdfPage}&toolbar=0&…`、無ければ `…/raw#toolbar=0&…`。
2. `isImage(filename)` → `<img src=…/raw>`（中央寄せ）。
3. `isSpreadsheet(filename)` → `<SpreadsheetPreview docId filename />`。
4. `isConvertibleToPdf(filename)` → `<RenderedPdfPreview docId filename />`。
5. `getTextPreviewKind(filename)` → `<RawTextContent>`（内部で `useRawText(docId)`）。
6. それ以外 → `<UnsupportedPreview docId onShowParsed? />`。

`useRawText` は 5 のときのみ docId を渡す（それ以外は `null` で idle）。
`framed` による枠付けは PDF/画像/表計算/Office の各カードに適用し、テキスト/非対応は
自然な全高表示にする。

`UnsupportedPreview` の拡張: `onShowParsed?: () => void` を受け取り、指定時は
原本ダウンロードボタンに加えて「引用テキストを表示」ボタン（`t.sources.showCitedText`）を
並べる。未指定（modal）時は従来どおりダウンロードのみ。

### 3. `documents-modal.tsx` のリファクタ

- インライン定義の `UnsupportedPreview` / `RenderedPdfPreview` / `RawTextContent` を
  `original-preview.tsx` からの import に置換。
- `mime` ベースの `isPdf` / `isImage` を `file-types.ts` の拡張子 helper に寄せる
  （`selected.mime === "application/pdf"` → `isPdf(selected.filename)`、
   `selected.mime.startsWith("image/")` → `isImage(selected.filename)`）。
- 原本タブ本体（`tab === "pdf"` の長い分岐 6 種）を `<OriginalPreview framed … pdfPage 無し … />`
  1 つへ置換。`rich` タブ用の `useRawText` / `MarkdownView` / `JsonView` 等は残す。
- `tab === "rich"` の `RawTextContent`（children 付き）の用法は維持する。
- 表示・タブ名・挙動は現状維持。

### 4. `right-panel.tsx` の変更

- `ViewMode` の `"pdf"` を `"original"` に改名。`isPdf` 限定の生成・フォールバックを撤去し、
  「原本」タブを全形式で常設する（`viewMode` 既定は従来どおり `"html"`）。
- 原本タブのラベルは形式に応じて動的化（modal と同じ語彙を再利用）:
  - 表計算 → `t.documents.tabSpreadsheet`
  - Office 変換 → `t.documents.tabConvertedPdf`
  - それ以外（PDF/画像/テキスト/非対応）→ `t.documents.tabOriginal`
- 原本本体を
  `<OriginalPreview docId={active.id} filename={active.title}
     pdfPage={pdfPage} onShowParsed={() => setViewMode("html")} />`
  に置換（`framed` は付けない＝フラッシュ表示）。`pdfPage` は従来のハイライト/先頭
  セクションからの算出を維持し、PDF のときのみ意味を持つ。
- 既存の raw 欠落 HEAD チェック（`missingRawId` / `rawMissing` / 専用 `deletedTitle`
  分岐）を撤去。原本欠落は `OriginalPreview` 内の各エラー経路 → `UnsupportedPreview`
  （ダウンロード + `onShowParsed` で「引用テキストを表示」）に標準化する。
- `html`（HTML整形）/ `text`（解析テキスト）タブ＝引用セクションの整形ビューは現状維持。

### 5. i18n

- 新規キーは原則不要。原本タブのラベルと非対応フォールバックは `documents` namespace の
  `tabOriginal` / `tabSpreadsheet` / `tabConvertedPdf` / `unsupportedTitle` /
  `unsupportedDescription` / `unsupportedDownload` を再利用する。
- パネルの「引用テキストを表示」は既存の `sources.showCitedText` を使う。
- 使われなくなる `sources` キー（`viewPdf` / `deletedTitle` / `deletedDesc`）を
  zh・ja 両辞書から削除する。zh が唯一の出所で ja は型注釈 + parity テストにより
  キー対等を強制しているため、両方を同時に削除し parity を保つ。

## データフロー

```
right-panel "原本"タブ
  → OriginalPreview(docId, filename, pdfPage, onShowParsed)
    → 形式ディスパッチ（file-types.ts の拡張子判定）
      → iframe / img / SpreadsheetPreview / RenderedPdfPreview / RawTextContent / UnsupportedPreview
    → 各プレビューは /api/documents/[id]/raw（または /rendered）を内部 fetch
```

modal も同じ `OriginalPreview` を `framed` 付きで使う。

## エラー処理

- raw 404（削除済み）/ 変換失敗 → `UnsupportedPreview`。panel では `onShowParsed` により
  「HTML整形」へ退避でき、引用テキストは引き続き読める。
- 大きいテキストは `useRawText` が truncate し、`RawTextContent` が注記を出す（既存挙動）。

## テスト

- `right-panel.stories.tsx` に原本タブの表示ストーリーを追加:
  PDF / docx（変換PDF）/ xlsx（表計算）/ txt（テキスト）/ 非対応 の各ケース。
  MSW で `/api/documents/:id/raw`（および `/rendered`）をモックする。
- 既存 `documents-modal` 系ストーリー・テストが緑のままであること（リグレッション確認）。
- ゲート: `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm build`。
- i18n parity: `pnpm test src/i18n/dictionary.test.ts`（キー削除後の zh/ja 対等を確認）。

## リスク / 留意点

- Office→PDF 変換（`RenderedPdfPreview`）は初回数秒の変換待ちが入る。パネルは幅が
  狭いため、変換中表示（`t.documents.pdfConverting`）が窮屈に見えないか目視確認する。
- `framed` の有無で modal の画像パディング等が微変化しないよう、modal 側の見た目を
  ストーリーで突き合わせる。
- パネルの原本タブ常設により、テキスト系資料では「原本（生テキスト）」と「解析テキスト」が
  並ぶ。役割が異なる（原本 = 無加工、解析テキスト = チャンク化後）ため許容。
