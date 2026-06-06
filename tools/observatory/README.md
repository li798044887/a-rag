# LLM/プロンプト観測ダッシュボード（Observatory）

アプリ本体とは**別枠**の dev 専用ツール。本番と同じ `runAgent` を別ポートで回し、
全 LLM 呼び出し（chat / grade / queryRewrite / verify / revise）の**生プロンプトと生出力**を
観測する。検索は固定でき、プロンプトをその場で上書きして即再実行できる。

`src/` の外に隔離されており、アプリのビルド・型チェック・lint・テストには一切含まれない。
`src/` 側の痕跡は無害な dev シーム2個だけ（`run.ts` の `observe?`、`rag-client.ts` の transport フック）。

## 起動

1. フルスタックを起動（rag / postgres / qdrant / redis）。
2. `.env.local` に API キーと `RAG_SERVICE_URL` を設定。`OBSERVE_OWNER_ID` に
   索引済み文書を持つ既存 owner の id を指定（リプレイの再現性のため固定）。
3. `pnpm observe` → http://localhost:3030 （`OBSERVE_PORT` で変更可）

## 使い方

- 質問を入れて **Run**。右ペインに各 LLM 呼び出しの trace（送信 system / messages、出力、usage）が
  逐次表示される。
- `retrieve=live` で1回流すと検索応答が `snapshots/` に保存され、以降 `retrieve=replay` で
  検索が固定される（プロンプト差分だけを見たいとき）。
- 左ペインの各プロンプトを編集して Run すると、その role の system が差し替わって再実行される
  （エフェメラル上書き。ファイルは書き換えない）。`overridden` バッジで差し替えを確認できる。

## スナップショット

`tools/observatory/snapshots/`（gitignore）。クリアは:

```bash
curl -X DELETE http://localhost:3030/api/snapshots
```

## テスト

```bash
pnpm observe:test   # observe / replay のユニットテスト（アプリの pnpm test とは独立）
```

## 仕組み（概要）

- `observe.ts` — AI SDK の `wrapLanguageModel` ミドルウェア。送信直前の system 文字列で役割を判定し、
  上書きを適用し、入出力をキャプチャ。chat はストリームをパススルーしながら全文を記録。
- `replay.ts` — `ragFetch` の transport を差し替え、`method:path:body` キーで snapshot 保存/再生。
- `server.mts` — Vite middlewareMode で UI(HMR) を配信し、`/api/defaults`・`/api/run`(SSE)・
  `/api/snapshots` を生やす。`runAgent` は Vite の SSR ローダでエイリアス解決込みに読む。
