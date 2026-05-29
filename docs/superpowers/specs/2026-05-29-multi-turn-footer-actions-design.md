# 複数ターン対応：回答フッター・操作・エクスポート

作成日: 2026-05-29

## 背景・課題

回答フッター（⏱時間 / トークン / sources チップ ＋ コピー・再生成・👍👎）と、ヘッダの操作（共有・Markdownエクスポート・一次資料）が、現状は実質「単一ターン（最新ターン）」にしか対応していない。

- `messages.tsx` の `AnswerFooter` は `isLast && status === "done"` のときのみ描画され、過去ターンには出ない（コメントに「フッター操作はスレッド単位の状態を扱うため最新ターンのみに表示」とある）。
- `workspace.tsx` の `feedback` はスレッド全体で 1 個の `"up" | "down" | null` であり、ターン別ではない。
- `copyAnswer` / `regenerate` は常に `lastTurn` / 最後の `userQuery` を対象にする。
- ヘッダの Markdown エクスポート（`exportThread`）は `lastTurn` の回答・出典だけを書き出し、複数ターンを含まない。

各 `Turn` は既に `tokens` / `durationMs` / `sources` / `citationMap` を個別に保持しているため、表示の per-turn 化はデータ的には可能。論点は「再生成（以降破棄）」のサーバ永続化との整合性。

## 目的

複数ターンの会話において、各回答が自身の指標と操作（コピー・再生成・フィードバック）を持ち、エクスポートはスレッド全体を含むようにする。

## スコープ（合意済み）

- 回答フッター（指標＋操作）を全 `done` ターンに表示する。
- Markdown エクスポートをスレッド全体（全ターンの Q&A ＋ 出典）にする。
- 共有はスレッド全体として扱う（現状の `item: null` 挙動を維持。実質変更なし）。
- 過去ターンの「再生成」は **そのターンを再生成し、それ以降のターンを破棄**（ChatGPT 風、会話の分岐は持たない）。
- 👍👎フィードバックは **クライアントのみ保持**（サーバ永続化しない。現状踏襲）。ターン別に持つ。

## 非スコープ

- フィードバックのサーバ永続化・新規スキーマ。
- 会話の分岐（ブランチ）管理。
- 一次資料パネルの件数表示の変更（現状の「アクティブ引用ターン追従」を維持）。

## アーキテクチャ / 変更点

### 1. サーバ整合性（採用：案A — サーバ側 truncate）

サーバ（`/api/chat` → `saveCompletedMessage`）はターンを 1 メッセージとして永続化し、継続実行時は保存済み全ターンを履歴として読み込む。クライアントだけで以降ターンを破棄しても DB に残るためリロードで復活する。これを防ぐため、再生成時に **履歴読込の前に** 当該 index 以降のメッセージ＋引用を DB から削除する。

検討した代替案：
- 案B（クライアントのみ truncate、サーバ削除なし）：実装は軽いがリロードで破棄ターンが復活し、複数ターン体験として破綻するため不採用。
- 案C（別 DELETE エンドポイント）：案A と等価だが HTTP 往復が増えるため不採用。

### 2. `lib/threads.ts`

新規関数を追加する。

```ts
/** createdAt 昇順で fromIndex 番目以降のメッセージと付随する引用を削除する。 */
export async function deleteMessagesFrom(
  threadId: string,
  userId: string,
  fromIndex: number,
): Promise<void>
```

- 所有者検証（`threads.userId === userId`）を行ってから、`messages` を `createdAt` 昇順で取得し、index >= `fromIndex` の行の id を集める。
- 対象 messageId の `citations` を先に削除し、続いて `messages` を削除する。
- 対象が空なら何もしない。
- `fromIndex <= 0` の場合はスレッドの全メッセージ削除（スレッド自体は残し、最初のターンとして再実行する想定）。

### 3. `/api/chat/route.ts`

- リクエストボディに `regenerateFrom?: number` を追加で受け取る。
- `threadId` が存在し `regenerateFrom` が指定されている場合、**履歴読込（`getThreadMessages`）の前に** `deleteMessagesFrom(tid, claims.sub, regenerateFrom)` を呼ぶ。これにより `history` は 0..(regenerateFrom-1) のみになる。
- その後は通常どおり `runAgent` を流し、`done` 時に新メッセージを追記する（index `regenerateFrom` のメッセージとして DB 上も整合）。

### 4. `hooks/use-agent.ts`

`run` のオプションに以下を追加する。

- `truncateFrom?: number` — `appendTurn` の前にクライアント側 `turns` を `slice(0, truncateFrom)` してから新ターンを末尾に追加。
- `regenerateFrom?: number` — POST body（`/api/chat`）へ転送する。

`appendTurn` を `truncateFrom` 対応に変更する：

```ts
const appendTurn = (k: string) => setConvs((prev) => {
  const turns = prev[k]?.turns ?? [];
  const base = truncateFrom != null ? turns.slice(0, truncateFrom) : turns;
  return { ...prev, [k]: { turns: [...base, emptyTurn(query, attachments)] } };
});
```

`X-Thread-Id` リバインド経路は `threadId`（既存スレッド）前提のため `moved = []` 側に入り影響しない。`reduceTurn` は変更不要。

### 5. `components/workspace/workspace.tsx`

- `feedback` 状態を `Record<number, "up" | "down">`（ターン index キー）に変更。`newChat` / `selectThread` / `deleteThread`（アクティブ削除時）でリセット（`{}`）。`startRun` でも再生成時に再評価する（下記）。
- `copyAnswer(turnIdx: number)` — `turns[turnIdx].answer` をコピー対象にする。
- `regenerate(turnIdx: number)` — `startRun` を再生成モードで呼ぶ。
- `startRun` を再生成対応にする。シグネチャ案：`startRun(query: string, opts?: { regenerateFrom?: number })`。
  - `opts.regenerateFrom != null` のとき：
    - `query = turns[regenerateFrom].query`、`attachments = turns[regenerateFrom].attachments`（名前配列）。
    - `continueId = activeThreadId`（既存・done スレッド）。
    - `agent.run(..., continueId, model.id, { truncateFrom: regenerateFrom, regenerateFrom, ... })`。
    - フィードバックは `regenerateFrom` 以降のキーを破棄（`< regenerateFrom` は保持）。
  - 通常実行時は従来どおり（`feedback` は新ターン分が未設定なso問題なし）。
- `exportThread` を全ターン反復に変更：
  - 各ターンを `## 質問\n{query}\n\n{answer}` の形で連結。
  - 出典は全ターン分を集約し `id` で重複排除して `## 参考資料` に一覧化。
  - スレッドが空（`turns.length === 0`）ならトーストで通知（従来の `userQuery` 空チェックを置換）。
- 一次資料ヘッダ件数・共有ボタンは変更なし。

### 6. `components/chat/messages.tsx`

- `Transcript` の `AnswerFooter` 描画条件を `turn.status === "done"`（`isLast` 撤廃）に変更。
- `onCopy` / `onRegenerate` / `onFeedback` を per-turn 化し `turnIdx` を渡す。
  - `onCopy={() => onCopy(idx)}`、`onRegenerate={() => onRegenerate(idx)}`、`onFeedback={(v) => onFeedback(v, idx)}`。
  - `feedback={feedbackMap[idx] ?? null}`。
- `Transcript` の props 型を更新（`onCopy: (turnIdx) => void` 等、`feedback` を `Record<number,...>` に）。
- `CancelledNotice` の `onRetry` は引き続き最後のターン（cancelled は常に末尾）に対応するので `() => onRegenerate(idx)`。

### 7. `components/chat/answer-footer.tsx`

- `AnswerFooter` の props 型自体は据え置き可能（`onCopy: () => void` 等）。呼び出し側（`messages.tsx`）でクロージャに `idx` を閉じ込めるため、コンポーネント本体は変更最小（必要なら無変更）。
- 再生成ボタンは実行中（スレッドに running ターンがある間）は無効化を検討（`messages.tsx` 側で `running` を渡すか、`done` ターンのみ表示なので実害は小さい）。実装時に判断。

## データフロー（再生成）

1. ユーザーが過去ターン `i` の「再生成」を押す。
2. `workspace.regenerate(i)` → `startRun(_, { regenerateFrom: i })`。
3. `startRun`：`query = turns[i].query`、フィードバックを `i` 以降破棄、`agent.run(..., { truncateFrom: i, regenerateFrom: i })`。
4. `use-agent`：クライアント turns を `slice(0, i)` し、新 running ターンを末尾（= index `i`）に追加。`/api/chat` へ `regenerateFrom: i` を POST。
5. `/api/chat`：`deleteMessagesFrom(tid, user, i)` で DB の index `i` 以降を削除 → 履歴 0..i-1 を読込 → 生成 → `done` で新メッセージ追記。
6. リロード時も DB は 0..i（再生成分）で整合。

## エラーハンドリング

- `deleteMessagesFrom` の失敗：履歴読込前に投げられるため、`runAgent` 開始前に通常の例外として 500 か SSE `error` で扱う（実装時に既存の例外フローへ合わせる）。
- 永続化失敗（`saveCompletedMessage`）は従来どおり `done` 送出後のログのみ。
- フィードバックはクライアントのみのため永続化失敗の概念なし。

## テスト

- `lib/threads`：`deleteMessagesFrom` のユニットテスト（既存 `threads.test.ts` の方式に合わせる）。index 以降のみ削除・所有者外は不可・citations も削除・空対象は no-op を確認。
- `use-agent`：`run` の `truncateFrom` で turns が切り詰められてから新ターンが追加されることを確認（`reduceTurn` は純関数なので既存テスト維持）。
- 既存の `threads.test.ts` が壊れないことを確認。

## 受け入れ基準

- 複数ターンの会話で、各 `done` 回答の下にその回答固有の指標（時間・トークン・出典数）と操作が表示される。
- 各回答のコピーがそのターンの本文をコピーする。
- 👍👎が回答ごとに独立して切り替わる（スレッド切替・新規でリセット）。
- 過去ターンの再生成で、その質問が再実行され、それ以降のターンが画面・DB 双方から消える。リロードしても破棄ターンは復活しない。
- Markdown エクスポートが全ターンの Q&A と集約済み出典を含む。
