# Office 文書のブラウザプレビュー（LibreOffice→PDF レンダリング）

## 背景・課題

文書管理モーダル（`documents-modal.tsx`）の「原本」タブは現在、

- PDF → iframe
- 画像 → img
- それ以外（xlsx/doc/docx/pptx 等） → 「この形式はブラウザでプレビューできません」フォールバック

という分岐になっており、Office 系の原本はブラウザ内で閲覧できない。ダウンロードするか、解析済みの「解析テキスト」「HTML整形」タブで内容を確認するしかない。

オフライン（`HF_HUB_OFFLINE=1`）・Docker 前提のため、Office Online / Google Docs Viewer など外部ビューアの iframe 埋め込みはプライバシー・到達性の両面で採用できない。

## 方針（案A：サーバ側 PDF 変換、遅延＋キャッシュ）

原本を **LibreOffice headless で PDF にレンダリング**し、既存の PDF プレビュー（iframe）を流用する。

- 変換タイミング：プレビュー初回アクセス時に rag コンテナ内で同期実行（遅延変換）
- 生成 PDF をディスクにキャッシュし、2 回目以降は即時返却
- 既存文書もそのまま対象になり、worker / DB / 再索引の変更は不要

採用しなかった案：

- 案B（クライアント側 SheetJS / docx-preview）— レガシー `.doc`/`.xls`/`.ppt` 非対応、図表欠落
- 取り込み時変換 — 閲覧されない文書も毎回変換しコスト増、既存文書に再索引が必要

## アーキテクチャ

### バックエンド（rag）

**1. Dockerfile**

- `libreoffice-writer libreoffice-calc libreoffice-impress` を追加（フルパッケージは避けサイズ抑制）
- `fonts-noto-cjk` を追加（無いと日本語が豆腐になるため必須）
- ベイク済みイメージのため反映には `docker compose up -d --build rag` が必要

**2. `documents_service.py` ヘルパー（純関数中心・単体テスト可能）**

- `CONVERTIBLE_EXTS = {doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp, rtf}`
- `is_convertible(path: str) -> bool` — 拡張子判定
- `rendered_pdf_for(raw_path: str) -> Path` — `<base>_rendered.pdf`（既存 `_assets`/`_mineru` と同じ決定的命名）
- `convert_to_pdf(raw_path: str) -> Path` — キャッシュがあれば返却。無ければ `soffice --headless --convert-to pdf` を実行。並行実行の衝突回避のため毎回ユニークな `-env:UserInstallation=file://…` を指定し、一時ディレクトリへ出力→`os.replace` でアトミックにキャッシュ確定。タイムアウト付き。失敗時は例外。
- `cleanup_document_files` に `_rendered.pdf` 削除を追加

**3. 新エンドポイント `GET /documents/{id}/rendered`**

- 内部トークン依存＋所有者チェック（既存 `raw` と同パターン）
- 変換不可形式 / 所有者不一致 / 原本欠落 → 404
- 変換失敗 → 422
- 成功 → `FileResponse(media_type="application/pdf", content_disposition_type="inline")`

### フロントエンド

**1. Next.js プロキシ `src/app/api/documents/[id]/rendered/route.ts`**

- セッション認証 → rag `/rendered` をストリーム中継（`raw` route と同形、download パラメータなし、常に application/pdf inline）

**2. `documents-modal.tsx`**

- `isConvertible`（`selected.filename` の拡張子由来）を追加
- 「原本」タブ分岐に convertible を追加。`/api/documents/{id}/rendered` を `fetch` して blob URL を生成し iframe に渡す方式：
  - 変換中は「変換中…」表示
  - HTTP エラー時は既存の「プレビューできません」フォールバックへ退避（iframe に生 JSON を出さない）
  - blob URL は差し替え・アンマウント時に `URL.revokeObjectURL`
- 変換不可（古い形式の一部・破損）は従来どおりダウンロード導線

## データフロー

```
modal（convertible 選択）
  → fetch /api/documents/{id}/rendered   （Next, セッション認証）
    → rag GET /documents/{id}/rendered   （内部トークン）
      → convert_to_pdf(raw_path)
          キャッシュ有 → そのまま返す
          キャッシュ無 → soffice 実行 → _rendered.pdf 確定
      → FileResponse(application/pdf)
  → blob URL → <iframe>
```

## エラーハンドリング

| 状況 | rag | フロント |
|------|-----|---------|
| 変換不可拡張子 | 404 | フォールバック表示 |
| 所有者不一致 / 原本欠落 | 404 | フォールバック表示 |
| soffice 失敗・タイムアウト | 422 | フォールバック表示 |
| 成功 | 200 application/pdf | iframe プレビュー |

## テスト（TDD）

- rag pytest
  - `is_convertible` の真偽（拡張子別）
  - `rendered_pdf_for` のパス導出
  - `cleanup_document_files` が `_rendered.pdf` を削除すること
  - エンドポイント：401（トークン無）／404（非所有者・変換不可）／422（変換失敗）／200 application/pdf（`convert_to_pdf` を monkeypatch）
- Next route：`ragFetch` モックで認証・中継・404
- フロント：convertible 判定とタブ分岐（既存テスト構成に合わせる）

## スコープ外（YAGNI）

- xlsx の SheetJS インタラクティブ表示（案D 後段）
- 取り込み時の事前 PDF 生成
- CSV の変換（解析テキストで十分。将来 SheetJS 候補）

## 既知のトレードオフ

- イメージサイズが数百 MB 増加（LibreOffice + CJK フォント）
- 横長 xlsx は PDF 化で改ページが不格好になりうる（原本ダウンロードで補完）
- 初回プレビューに数秒の変換待ち（キャッシュ後は解消）
