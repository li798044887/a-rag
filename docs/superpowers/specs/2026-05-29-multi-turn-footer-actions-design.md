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
- 一次資料パネルは引き続き「アクティブ引用ターン追従」だが、**どのターンの出典かを明示する UX**（案A）を追加する（後述セクション8）。

## 非スコープ

- フィードバックのサーバ永続化・新規スキーマ。
- 会話の分岐（ブランチ）管理。
- パネルで全ターン出典を集約表示する方式（案B）・ヘッダ件数ボタンの撤廃（案C）は不採用。

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
- 共有ボタンは変更なし。一次資料ヘッダ件数・パネル UX はセクション8。
- 出典パネルをターンへ紐づけて開くハンドラ `openSourcesForTurn(turnIdx)` を追加：`setActiveCiteTurn(turnIdx)`、`setActiveSourceId(該当ターンの先頭 source.id)`、`setHighlightSectionId(null)`、`setRightPanelOpen(true)`。

### 6. `components/chat/messages.tsx`

- `Transcript` の `AnswerFooter` 描画条件を `turn.status === "done"`（`isLast` 撤廃）に変更。
- `onCopy` / `onRegenerate` / `onFeedback` を per-turn 化し `turnIdx` を渡す。
  - `onCopy={() => onCopy(idx)}`、`onRegenerate={() => onRegenerate(idx)}`、`onFeedback={(v) => onFeedback(v, idx)}`。
  - `feedback={feedbackMap[idx] ?? null}`。
- フッターの「N sources」チップから出典パネルを開けるよう `onOpenSources={() => onOpenSources(idx)}` を渡す。
- パネルが開いていてアクティブ引用ターン = `idx` のとき、そのフッターを `active` 状態にするため `sourcesActive={rightPanelOpen && activeCiteTurn === idx}` を渡す。
- `Transcript` の props 型を更新（`onCopy: (turnIdx) => void` 等、`feedback` を `Record<number,...>`、`onOpenSources`・`activeCiteTurn`・`rightPanelOpen` を追加）。
- `CancelledNotice` の `onRetry` は引き続き最後のターン（cancelled は常に末尾）に対応するので `() => onRegenerate(idx)`。

### 7. `components/chat/answer-footer.tsx`

- props に `onOpenSources: () => void` と `sourcesActive: boolean` を追加。
- 「N sources」`<span>` チップを `<button>` 化し `onClick={onOpenSources}`。`sourcesActive` のとき accent 系のボーダー/文字色でアクティブ表示（既存 chip スタイルにアクティブ variant を足す）。他のチップ（時間・トークン）は非インタラクティブのまま。
- `onCopy` / `onRegenerate` / `onFeedback` は据え置き（呼び出し側がクロージャで `idx` を閉じ込める）。
- 再生成ボタンは `done` ターンのみ表示のため実行中の押下は基本的に発生しない。実装時に必要なら無効化を検討。

### 8. 一次資料パネルの UX（案A：ターンに明示紐づけ）

「アクティブ引用ターン」がどのターンか分からない問題を、追加的な3つの手当てで解消する（既存挙動は壊さない）。

1. **フッターの出典チップを入口にする**（セクション6・7）。各ターンの「N sources」チップをクリックすると、そのターンの出典でパネルが開く（`openSourcesForTurn(idx)`）。本文中の `[n]` クリック（既存 `openCitation`）と並ぶ、より発見しやすい導線。
2. **パネルヘッダにターン文脈を表示**（`components/sources/right-panel.tsx`）。タイトル行「一次資料 + 件数」の直下に、対象ターンの質問スニペットを muted で表示する。例：`「組織再編の論点は？」の出典`。
   - `RightPanel` に `contextQuery?: string` prop を追加し、`workspace.tsx` から `citeTurn?.query` を渡す。
   - 1ターンしか無い会話でも表示してよい（害がなく一貫する）。長文はトランケート。
3. **アクティブターンの可視化**（セクション6）。パネル表示中、対象ターンのフッター出典チップを accent のアクティブ状態にして、会話側とパネルの対応を一目で示す（`sourcesActive`）。

ヘッダの「一次資料 (N)」グローバルボタンは現状どおり `citeTurn`（アクティブ引用ターン、既定は末尾）追従を維持する。パネルヘッダのラベルとチップのアクティブ表示で曖昧さが解消されるため、件数の意味も明確になる。

レイアウト（パネルヘッダ）：

```
┌───────────────────────────┐
│ □ 一次資料  (2)        ↗  ✕ │  ← 既存のタイトル行
│ 「組織再編の論点は？」の出典     │  ← 追加：ターン文脈（muted, truncate）
├───────────────────────────┤
│ [1] 商法xxx                │
│ [2] 定款yyy                │
```

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
- 各ターンのフッター出典チップから、そのターンの出典でパネルを開ける。パネルヘッダに対象ターンの質問スニペットが表示され、会話側では対象ターンのチップがアクティブ表示になる。
