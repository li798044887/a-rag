# MinerU 抽出画像の実表示（エンドツーエンド）設計

- 日付: 2026-05-30
- ブランチ: `feat/mineru-image-display`

## 背景・問題

一次資料パネルで画像が `[image]` というプレースホルダー文字列として表示され、実画像が出ない。

調査の結果、これは「画像表示の失敗」ではなく **実画像を表示する配線がそもそも存在しない**ことが原因と判明した。パイプライン全体で画像が一度も「ファイル」として扱われていない:

1. **パース** (`rag/app/parsing/mineru.py:33-34`): image 項目から `img_caption` のみ取得し、`img_path`（出力画像ファイルへの相対パス）を捨てている。`ParsedBlock` にも画像パス用フィールドが無い。
2. **チャンク化** (`rag/app/chunking/chunker.py:87-88`): `payload = block.caption or block.text or "[image]"`。キャプションが無い画像はチャンク本文が文字どおり `"[image]"` になる。
3. **DB** (`rag/app/models.py`): `Chunk` は `text` のみで画像参照列が無く、`"[image]"` がテキストとして保存される。
4. **配信・描画**: MinerU は画像を `out_dir` に書き出すが worker はどこにも永続化せず、配信ルートも無い。フロント `right-panel.tsx` の `SectionBody` は `<table>` だけ特別扱いし、残りはテキスト描画のため `[image]` が素の文字列として出る。

## 確定した方針

- **画像チャンクは表示専用**: 埋め込み／Qdrant 索引から除外する。ただし一次資料パネルで順序通り表示するため Postgres の `chunks` 行は残す。
- **画像URLは Next.js API 層で絶対パス生成**: 真実の所在を一箇所（`tools.ts` の snippet 生成）に集約する。rag サービスは Web のオリジン／URL 形を知らずに済む（相対 `images/...` のみ保持）。
- **DB マイグレーション不要**: markdown を `chunk.text` に焼き込む（既存の表 HTML と同じパターン）。画像保存先は `raw_path` から決定的に導出し、新規列を追加しない。

## データフロー

```
MinerU content_list.json (img_path: "images/x.jpg")
  → mineru.py:        ParsedBlock.image_path に保持
  → worker:           画像ディレクトリを安定パス {raw_path}_assets/images/ へコピー
  → chunker:          image チャンク text = "![caption](images/x.jpg)"（相対） / block_type="image"
  → worker:           image チャンクは PG 行は作るが embedding・Qdrant upsert からは除外
  → tools.ts register: snippet 内の images/... を /api/documents/<id>/assets/images/... へ書き換え（絶対化）
  → citations テーブル: 絶対URL入り snippet を保存（ライブ toSources・再読込 sourcesFromCitations で共通）
  → frontend SectionBody: markdown 画像をパースして <img src=絶対URL> を描画
```

### URL 書き換えを `tools.ts` に集約する根拠

ソース構築経路は2つあり、どちらも `citations.snippet`（DB 永続化値）を `body` にしている:

- ライブ: `src/lib/agent/citations.ts` の `CitationRegistry.toSources()`
- 再読込: `src/lib/threads.ts` の `sourcesFromCitations()`（DB の `citations.snippet` から復元）

`snippet` は `src/lib/agent/tools.ts` の `register()` 呼び出し時（116行・145行付近）に生成され、`documentId` がスコープ内にある。ここで相対→絶対へ書き換えれば、ライブ・再読込・永続化のすべてを一度に満たせる。なお画像チャンクは表示専用（Qdrant 非索引）のため、パネルへは `fetch_document` 経路（145行付近）でのみ到達するが、両 register 箇所に書き換えを適用して一貫性を担保する。

## 変更点

### rag（要 `docker compose up -d --build rag` ＋ 既存ドキュメント再索引）

1. **`rag/app/parsing/types.py`** — `ParsedBlock` に `image_path: str | None = None` を追加。
2. **`rag/app/parsing/mineru.py`** — image 項目から `item.get("img_path")` を取得して `image_path` に格納。
3. **`rag/app/chunking/chunker.py`** — `emit_atomic` の image 分岐で、`image_path` があれば text を `![{caption}]({image_path})` に。`image_path` 無しのときのみ従来の `[image]` フォールバック。`block_type` は `"image"` のまま。
4. **`rag/app/worker.py`** —
   - (a) parse 後、MinerU 出力の `images/` ディレクトリを `{raw_path}_assets/images/` へコピー（冪等: 既存を消して作り直し）。
   - (b) Chunk 行は全件 PG へ insert（順序維持）。embedding 用テキスト列と Qdrant upsert からは `block_type == "image"` を除外する。
5. **`rag/app/routers/documents.py`** — `GET /documents/{document_id}/assets/{asset_path:path}` を新規追加。internal-token 依存、`owner_user_id` クエリで所有者チェック、`{raw_path}_assets` を基準にパス解決し **パストラバーサル防御**（解決後パスが基準ディレクトリ配下であることを検証）、`FileResponse` で返す。

### Next.js

6. **`src/app/api/documents/[id]/assets/[...path]/route.ts`** — 新規。`raw` ルート（`src/app/api/documents/[id]/raw/route.ts`）と同じ構造で rag の assets エンドポイントへプロキシし、`owner_user_id=claims.sub` を付与。content-type をそのまま透過。
7. **`src/lib/agent/tools.ts`** — `resolveImageUrls(text, documentId)` ヘルパーを追加し、snippet 生成 2箇所（116行・145行付近）に適用。相対 `images/...` を `/api/documents/<id>/assets/images/...` に書き換える。既に絶対なURL・非画像リンク・通常テキストは変更しない。
8. **`src/components/sources/right-panel.tsx`** の `SectionBody` — 既存の `<table>` 抽出に加え、markdown 画像記法 `![alt](url)` をパースして `<img>` を描画。src は既に絶対（`/api/...`）。スタイル: `max-width:100%`・角丸・境界線・`loading="lazy"`・`alt`・読み込み失敗時フォールバック表示。

## テスト（TDD）

- **chunker**: image ブロック → markdown 画像テキスト生成（caption あり: `![cap](images/x.jpg)` / caption 無し: `![](images/x.jpg)` / img_path 無し: `[image]`）。
- **worker**: `block_type=="image"` チャンクが embedding テキストと Qdrant upsert から除外され、PG 行としては残ることを確認（埋め込み対象件数・upsert ペイロード件数の検証）。
- **`resolveImageUrls`**: 相対→絶対の書き換え、既に絶対なURLを二重変換しない、`images/` 以外の通常リンクを壊さない、1テキスト内の複数画像、表 HTML やテキストとの混在で破壊しない。
- **assets ルート（rag）**: 所有者不一致で 404、パストラバーサル（`../`）を拒否、正常系でファイル返却。
- **SectionBody**: markdown 画像が `<img>` として描画される（既存と同様の単体／Storybook）。

## 影響範囲・留意点

- **既存ドキュメントは再索引が必要**（画像 markdown と `_assets` が無いため）。デモ PDF は再アップロード／再索引で対応する。
- **キャプション付き画像も検索からは外れる**。テキスト埋め込み（BGE-M3）では元々画像内容を読めず、MinerU はキャプションを隣接テキストブロックとしても出すことが多いため実害は最小と判断。
- rag は焼き込み Docker イメージのため、`rag/` 変更後は `docker compose up -d --build rag` での再ビルドが必須。

## 非対象（YAGNI）

- VLM/OCR による画像内容のキャプション生成・検索対応。
- 画像のサムネイル生成・リサイズ。
- 回答本文（チャット側）への画像インライン表示（今回は一次資料パネルのみ）。
