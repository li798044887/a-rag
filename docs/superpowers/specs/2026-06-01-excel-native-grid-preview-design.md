# Excel ネイティブグリッド・プレビュー 設計書

- 日付: 2026-06-01
- ステータス: 承認済み（実装計画待ち）
- スコープ: **プレビュー表示の改善のみ**（RAG 索引・チャンク化は対象外）

## 背景と問題

アップロード文書モーダルの「PDF変換原本」タブは、Excel（xlsx 等）を
LibreOffice headless で PDF 化（`rag/app/documents_service.py` の
`convert_to_pdf`）して iframe 表示している。Excel→PDF は印刷レイアウトへ
落とし込むため、表計算の構造——シートタブ・セルグリッド・列幅・複数シート・
セル結合——が失われ、ユーザーが原本（真相源）を目視確認しづらい。

本設計は、Excel の原本を**構造を保ったままブラウザで閲覧できる**ように
プレビュー機構を作り直す。RAG 用の MinerU パース／チャンク化には手を入れない。

## 方針

クライアント側で SheetJS により原本 xlsx を直接パースし、**Excel 風グリッド**
（行番号・列記号ヘッダ、シートタブ、セル結合、スティッキーヘッダ）で描画する。

- 原本 blob は既存の `GET /api/documents/[id]/raw` をそのまま利用。
- **サーバ変更なし**: rag Docker イメージにも Next.js API ルートにも変更不要。
- xlsx プレビュー時のみ `xlsx`(SheetJS) を**動的 import** し、メインバンドルを
  肥大化させない。
- 書式（セル背景色・罫線・フォント色）の再現は **YAGNI として含めない**。
  主訴は「構造」であり、グリッド・シート・結合・セルアドレスで満たす。

### 採用しなかった案

- **サーバ側 LibreOffice→HTML 変換**: soffice の HTML エクスポートは
  実質アクティブシートのみで、複数シートという構造欠落が解消されない。
- **サーバ側 openpyxl→JSON**: rag イメージの再ビルドが必要（運用上避けたい）で
  実装量も多い。インタラクティブなシート切替も別 API が要る。

## 依存追加

- `xlsx`（SheetJS, `0.18.5`）を pnpm で追加。読み取り専用途のため十分。
- 利用は動的 import（`await import("xlsx")`）に限定する。

## コンポーネント

### `sheetToGrid(ws)` — 純粋関数（テスト対象）

SheetJS のワークシートからグリッドモデルへ変換する純関数。
`src/components/documents/spreadsheet-preview.tsx` 内（またはローカル util）に置く。

入力: SheetJS `WorkSheet`
出力（グリッドモデル）:

```
{
  rowCount: number,            // !ref から算出した行数
  colCount: number,            // !ref から算出した列数
  cells: (string | null)[][],  // [row][col] の表示文字列（空セルは null）
  numeric: boolean[][],        // 右寄せ判定用（セルが数値型か）
  merges: { r: number; c: number; rs: number; cs: number }[], // 左上起点 + span
  colWidths: (number | null)[], // !cols 由来の列幅（px 目安、無ければ null）
}
```

仕様:
- セル表示は整形済み文字列 `cell.w` を優先（日付・数値が Excel 表示と一致）、
  無ければ `cell.v` を文字列化。
- `!ref` が無い／空シートは `rowCount=0, colCount=0` を返す。
- `!merges` を `{ r, c, rs, cs }`（開始セル + rowSpan/colSpan）へ正規化。
- `numeric` はセルの `t === "n"` を真とする。

### `SpreadsheetPreview` コンポーネント

`src/components/documents/spreadsheet-preview.tsx`（新規）。

props: `{ docId: string; filename: string }`

挙動:
1. `GET /api/documents/${docId}/raw` を `arrayBuffer` で取得。
2. `const XLSX = await import("xlsx"); const wb = XLSX.read(buf, { type: "array" });`
3. 状態: `loading | ready | error`、`activeSheet`（index）。`docId` ごとに key で
   再マウントされる前提（`RenderedPdfPreview` と同様）。
4. 描画: アクティブシートを `sheetToGrid` でモデル化し `<table>` で描画。
   - **コーナー＋列記号(A,B,C…)** ヘッダ行、各行に **行番号(1,2,3…)**。
   - 結合セルは左上セルに `rowSpan/colSpan`、被覆セルは描画スキップ。
   - 数値セル（`numeric`）は右寄せ。
   - **スティッキー**: ヘッダ行 `position: sticky; top`、行番号列 `left`、
     コーナーは両方固定。
5. **シートタブバー**（下部、Excel 風）: `wb.SheetNames` を並べ、クリックで
   `activeSheet` を切替（再 fetch 無し）。
6. **行クランプ**: 描画行を上限 **2,000 行**でクランプ。超過時は
   「全 N 行中、先頭 2,000 行を表示。原本をダウンロード」の注記＋ダウンロード導線
   （`/api/documents/${docId}/raw?download=1`）を表示。
7. **フォールバック**: パース失敗・空ブックは既存 `UnsupportedPreview`
   （原本ダウンロード導線）へ退避。空シートは「このシートは空です」表示。

### モーダル分岐 `documents-modal.tsx`

- ヘルパ `isSpreadsheet(filename)` を追加（対象拡張子 `.xlsx / .xls / .ods`。
  SheetJS が全て読める）。配置は `src/lib/file-types.ts`
  （`isConvertibleToPdf` と同居）。
- タブラベル: spreadsheet は `"スプレッドシート"`、その他 Office は従来どおり
  `"PDF変換原本"`、PDF/画像は `"原本"`。
- 本文分岐（`tab === "pdf"` の枝）:
  - `isSpreadsheet` → `<SpreadsheetPreview key={selected.id} docId={selected.id} filename={selected.filename} />`
  - else `isConvertible` → 既存 `<RenderedPdfPreview>`
  - PDF / 画像 / 非対応は据え置き。
- `selectDoc` の初期タブ判定（`previewable`）は spreadsheet も含める（既に
  `isConvertibleToPdf` が xlsx を含むため現状でも `"pdf"` 初期化される。
  ラベル変更後も同じ枝で表示されることを確認する）。

## データフロー

```
ユーザーが xlsx 文書を選択
  → documents-modal: isSpreadsheet(filename) === true
  → SpreadsheetPreview マウント
  → fetch /api/documents/{id}/raw (arrayBuffer)
  → dynamic import xlsx → XLSX.read
  → activeSheet を sheetToGrid → <table> 描画
  → シートタブで activeSheet 切替（再 fetch なし）
```

## エッジケース

- 巨大シート: 2,000 行でクランプ＋注記。
- パース失敗 / 空ブック: `UnsupportedPreview` へフォールバック。
- 空シート: 「このシートは空です」。
- 結合セルの被覆セル: 描画スキップ（重複描画しない）。
- 列幅が無い (`!cols` 不在): 既定幅で描画。

## サーバ side への影響

- 変更なし。xlsx は `/rendered`（PDF 化）を呼ばなくなるため soffice 変換が
  走らない。`convert_to_pdf` と `CONVERTIBLE_EXTS` は doc/docx/ppt/pptx/rtf/
  odt/odp 用に据え置く（xls/xlsx/ods はリストに残るが preview 経路では未使用）。

## テスト

- `sheetToGrid` の単体テスト（vitest）: 小さなワークシート固定値で
  結合セル・列幅・`.w` 整形・空セル・空シートを検証。
- Storybook ストーリー: 複数シート・結合あり・大きめ（クランプ）の 3 パターン。

## 非対象（YAGNI）

- セル背景色・罫線・フォント色などの書式再現。
- セル数式の表示（整形済み値 `cell.w` のみ表示）。
- 仮想スクロール（行クランプで代替）。
- RAG 索引・チャンク化ロジックの変更。
