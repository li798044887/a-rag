# 源文件削除時の専用プレビュー表示

## 背景・課題

引用来源パネル／文書モーダルの「原文件」タブで、源文件が削除済み（`/api/documents/[id]/raw` が 404）のとき、
現状は `UnsupportedPreview`（「此格式无法在浏览器中预览 / この形式はブラウザでプレビューできません」）に落ちる。

問題点：

1. **誤った原因表示** — 削除されただけなのに「フォーマット非対応」と表示される。
2. **無効な導線** — フォールバックの `下载原文件` ボタンは、ファイルが削除済みなので押しても 404 になる。

削除（404）を非対応フォーマットや解析失敗と区別し、**専用の削除メッセージ**を出す。

## 方針

`/raw`（および Office 変換の `/rendered`）が 404 を返したケースを「欠落（missing）」として個別に扱い、
非対応フォーマット（ファイルは存在）や解析失敗とは別のフォールバックを表示する。

deleteはドキュメント単位で raw ファイルごと消えるため、削除は全ファイル種別で 404 になる。
よって PDF/画像・テキスト・Office変換・表計算の全経路で missing を拾う。

## コンポーネント設計

### 新規 `MissingOriginalPreview`（`src/components/documents/original-preview.tsx`、export）

`UnsupportedPreview` と並ぶ専用フォールバック。

- 文言：新規 i18n キー `documents.missingTitle` / `documents.missingDescription`。
- **`下载原文件` ボタンは出さない**（404 になるため）。
- `onShowParsed` が渡された時のみ `查看引用文本`（`t.sources.showCitedText`）を表示。
- 見た目・レイアウトは `UnsupportedPreview` を踏襲（`grid place-items-center` の中央寄せカード）。

### 経路ごとの 404 分離

| 経路 | コンポーネント | 取得 | 変更内容 |
|---|---|---|---|
| PDF / 画像 | `RawObjectPreview` | HEAD `/raw` | HEAD は元々「欠落」検出専用。404（`missingFor === docId`）→ `UnsupportedPreview` から `MissingOriginalPreview` へ差し替え |
| テキスト系 | `useRawText` → `RawTextContent` | GET `/raw` | `RawTextState.status` に `"missing"` を追加。404 のとき `"missing"`、その他エラーは従来どおり `"error"`。`RawTextContent`：missing → `MissingOriginalPreview`、error → 従来 `UnsupportedPreview` |
| Office 変換 | `RenderedPdfPreview` | GET `/rendered` | state を `"loading" \| "ready" \| "error" \| "missing"` に拡張。404 → `"missing"` → `MissingOriginalPreview`、その他失敗 → 従来 `UnsupportedPreview` |
| 表計算 | `SpreadsheetPreview` | GET `/raw` | state に `"missing"` を追加。404 → `MissingOriginalPreview`、解析失敗等 → 従来 `Fallback`。`onShowParsed?` prop を追加し、`OriginalPreview` から透過して引用パネルでも `查看引用文本` を出せるようにする |

### 変えないもの

- `OriginalPreview` 末尾（現 line 184）の「本当に非対応フォーマット」フォールバックは `UnsupportedPreview` のまま。
  この経路はファイルが存在し、かつ既知のプレビュー手段が無いケースなので削除とは無関係。
- `SpreadsheetPreview` の解析失敗時 `Fallback`（`spreadsheetErrorTitle` 系）は従来どおり。

## i18n

zh が唯一の出所、ja は parity テストでキー対等を強制。両方に追加する。

- `documents.missingTitle`
  - zh: `源文件已删除或不可用`
  - ja: `原本ファイルは削除されたか利用できません`
- `documents.missingDescription`
  - zh: `该文件已被删除，无法预览或下载。可在「解析文本」标签页查看已提取的引用文本。`
  - ja: `このファイルは削除されており、プレビュー・ダウンロードできません。「解析テキスト」タブで抽出済みの引用テキストを確認できます。`

（文言は実装時に最終調整可。description は「解析文本」タブ／`查看引用文本` 導線と整合させる。）

## テスト

`src/components/documents/` の単体／ストーリーで以下を確認：

1. `/raw` が 404 のとき、各経路（PDF/画像・テキスト・Office・表計算）で **削除文言**が表示され、`下载原文件` ボタンが**出ない**こと。
2. 非 404 のエラー（解析失敗・変換失敗）では**従来のフォールバック**（`UnsupportedPreview` / Spreadsheet `Fallback`）が維持されること。
3. `onShowParsed` あり（引用パネル相当）で `查看引用文本` が出ること。
4. i18n parity テストが通ること（zh/ja に新キーが揃う）。

既存の MSW モックを使うストーリーがあれば、404 応答のバリアントを追加する。

## スコープ外

- `SpreadsheetGrid` 等、ファイルが存在する前提の表示ロジックは変更しない。
- 404 以外の HTTP エラー（5xx 等）の文言再設計はしない（従来フォールバック維持）。
