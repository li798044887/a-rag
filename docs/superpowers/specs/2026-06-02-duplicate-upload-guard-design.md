# 重複ファイルアップロードガード 設計書

- 日付: 2026-06-02
- ステータス: 承認済み（実装プラン作成へ）

## 目的

文書アップロードにおいて、同一内容のファイルが重複してアップロード・索引化されるのを防ぐ。内容ベース（コンテンツハッシュ）で重複を検知し、検知時はアップロードをエラーで弾く。

## 決定事項

| 論点 | 決定 |
| --- | --- |
| 重複時の振る舞い | **エラーで弾く**（既存と同一内容なら 409 を返し、ユーザーに通知） |
| 判定範囲 | **ユーザー単位**（同一 `owner_user_id` 内のみ） |
| error 状態の扱い | **重複扱いしない**（`status='error'` の文書は判定から除外し、再アップロード可） |
| ハッシュアルゴリズム | **SHA-256**（衝突耐性・現代標準。MD5 は採用しない） |
| 強制レイヤ | **バックエンド(rag)**（DBが真実の源。フロントは無変更） |

## アーキテクチャ

内容ハッシュは rag バックエンドの `create_document`（`rag/app/routers/documents.py`）でアップロードバイト列から計算し、`documents` テーブルに保存する。重複検知時は HTTP 409 を返す。Next の `/api/upload` は 409 を日本語メッセージにマッピングして転送し、既存のフロントフックがそれをファイルの error 表示として扱う。

### データフロー

```
ブラウザ → POST /api/upload (Next) → POST /documents (rag)
                                         ├ bytes = file.read()
                                         ├ content_hash = sha256(bytes)
                                         ├ raw_path.write_bytes(bytes)
                                         ├ 既存 active 重複あり? → 409
                                         └ INSERT documents(content_hash=...)
                                              └ 部分ユニークindex違反 → 409
```

## コンポーネント別設計

### 1. データモデル（`rag/app/models.py`）

`Document` に列を追加:

- `content_hash: Mapped[str | None]`（SHA-256 hex 64文字、nullable。既存行は NULL）

### 2. マイグレーション（alembic 新リビジョン）

- `documents.content_hash`（`sa.String()`, nullable）を追加。
- 部分ユニークインデックスを作成（Postgres）:

  ```sql
  CREATE UNIQUE INDEX uq_documents_owner_hash_active
    ON documents (owner_user_id, content_hash)
    WHERE content_hash IS NOT NULL AND status != 'error';
  ```

  → 「同一ユーザー・同一内容で error 以外」が同時に2行存在することを DB レベルで禁止し、同時二重アップロードの競合も塞ぐ。`status != 'error'` を含めることで error 行は判定から除外される。
- **バックフィル（ベストエフォート）**: 既存 `documents` の `raw_path` を読み SHA-256 を計算して `content_hash` を埋める。ファイル不在・読込失敗はスキップして NULL のままにする（例外を握りつぶす）。ローカル開発データは小規模なため許容。これにより機能導入前の文書も以後の重複判定対象になる。
- `downgrade()` はインデックスと列を削除。

注: alembic の `op.create_index` は `postgresql_where` 引数で部分インデックスを表現する。

### 3. rag `create_document`（`rag/app/routers/documents.py`）

擬似コード:

```python
data = await file.read()
content_hash = hashlib.sha256(data).hexdigest()
raw_path.write_bytes(data)              # 読み込みは1回のみ（既存どおり）

try:
    session = SessionLocal()
    try:
        existing = (
            session.query(Document)
            .filter(
                Document.owner_user_id == owner_user_id,
                Document.content_hash == content_hash,
                Document.status != "error",
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="duplicate document")
        doc = Document(..., content_hash=content_hash, status="queued")
        session.add(doc)
        session.flush()
        job = IngestJob(...)
        session.add(job)
        session.commit()
        result = IngestStarted(...)
    finally:
        session.close()
except HTTPException:
    raw_path.unlink(missing_ok=True)
    raise
except IntegrityError:                  # 部分ユニークindex違反（競合）
    raw_path.unlink(missing_ok=True)
    raise HTTPException(status_code=409, detail="duplicate document")
except Exception:
    raw_path.unlink(missing_ok=True)
    raise
```

- 事前 SELECT で通常ケースの 409 を返しつつ、部分ユニークインデックスを競合バックストップにする。
- いずれの 409・例外でも、書き込んだ `raw_path` を確実に削除する（孤児ファイルを残さない）。

### 4. Next `/api/upload`（`src/app/api/upload/route.ts`）

現状は `!res.ok` を一律 502 にしている。これを分岐:

- rag が **409** → `NextResponse.json({ error: "同じ内容のファイルが既にアップロードされています" }, { status: 409 })`
- それ以外の失敗 → 従来どおり `{ error: "索引化の開始に失敗しました" }`, 502

### 5. フロントフック / コンポーネント

**変更不要**。`src/hooks/use-uploads.ts` の `enqueue` は `/api/upload` が `!res.ok` のとき `{ error }` を読み、当該ファイルを `status:"error"` にして表示する。409 はこの経路でそのまま error 表示・トースト通知される。

## エラーハンドリング

- 409（重複）: ユーザーには「同じ内容のファイルが既にアップロードされています」を表示。サーバ側に孤児ファイルを残さない。
- 502（その他 rag 失敗）: 従来どおり「索引化の開始に失敗しました」。
- 競合（同時二重アップロード）: 部分ユニークインデックスが IntegrityError を発生させ、409 に正規化。

## テスト

### rag（pytest）
- 同一内容を2回 POST → 1回目成功、2回目 409。
- `status='error'` の同一内容文書がある状態で同一内容を POST → 成功（重複扱いしない）。
- 別 `owner_user_id` で同一内容 → 成功（ユーザー単位）。
- 別内容 → 成功。
- 409 発生時に `raw_path`（書き込んだ生ファイル）が削除されていること。

### Next route（既存 `documents.test.ts` 近傍 or 新規）
- rag 409 → route が 409 + 日本語メッセージを返す。
- rag 5xx → route が 502 を返す。

### マイグレーション
- upgrade で `content_hash` 列と部分ユニークインデックスが付与される。
- downgrade で両方削除される。

## 非対象（YAGNI）

- ブラウザ側の事前ハッシュ計算による帯域節約（重複でも一度はサーバへ送る。50MB 上限内で許容）。
- グローバル（全ユーザー横断）重複判定。
- 重複時に既存文書へ誘導する UI 導線。
