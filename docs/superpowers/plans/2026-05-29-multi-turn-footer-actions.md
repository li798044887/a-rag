# 複数ターン対応（フッター/操作/エクスポート/出典パネルUX）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各回答ターンが自分の指標・操作（コピー/再生成/👍👎）を持ち、再生成は「以降破棄」をサーバ整合で行い、エクスポートは全ターンを含み、一次資料パネルがどのターンの出典かを明示する。

**Architecture:** `Turn` は既に `tokens/durationMs/sources/citationMap` を個別保持。表示は per-turn 化するだけ。再生成は `/api/chat` に `regenerateFrom`（ターンindex）を渡し、履歴読込前に当該index以降のメッセージを DB から削除（`deleteMessagesFrom`）→ クライアントも turns を slice。フィードバックはターンindexキーのクライアント状態。出典パネルはアクティブ引用ターン追従のまま、入口（フッターチップ）・パネルヘッダのターン文脈ラベル・チップのアクティブ表示で対応を可視化。

**Tech Stack:** Next.js (App Router) / React / TypeScript / Drizzle ORM (Postgres, host:5433) / Vitest（node 環境、`src/**/*.test.ts`）。テストは `pnpm test`（= `vitest run`）。

設計spec: `docs/superpowers/specs/2026-05-29-multi-turn-footer-actions-design.md`

---

## ファイル構成

- `src/lib/threads.ts` — `deleteMessagesFrom` を追加（DB 操作）。
- `src/lib/threads.test.ts` — `deleteMessagesFrom` の DB 統合テストを追加。
- `src/app/api/chat/route.ts` — `regenerateFrom` 受領 → 履歴読込前に truncate。
- `src/hooks/use-agent.ts` — `run` に `truncateFrom` / `regenerateFrom` オプション追加。
- `src/lib/export.ts` — **新規**。`buildThreadMarkdown(turns)` 純関数。
- `src/lib/export.test.ts` — **新規**。`buildThreadMarkdown` の単体テスト。
- `src/components/workspace/workspace.tsx` — フィードバックを per-turn 化、`copyAnswer(idx)` / `regenerate(idx)` / `startRun(regenerateFrom)` / `openSourcesForTurn(idx)` / `exportThread` 全ターン化、props 配線。
- `src/components/chat/messages.tsx` — フッターを全 `done` ターンに描画、per-turn コールバック配線。
- `src/components/chat/answer-footer.tsx` — sources チップをボタン化＋アクティブ表示。
- `src/components/sources/right-panel.tsx` — ヘッダにターン文脈ラベル（`contextQuery`）。

注: UI コンポーネント（messages/answer-footer/right-panel/workspace）はリポジトリにコンポーネントテスト基盤が無い（vitest は node 環境・`.test.ts` のみ）。これらは型チェック＋手動確認で担保し、純ロジック（`deleteMessagesFrom`・`buildThreadMarkdown`）のみ自動テストする。

---

### Task 1: `deleteMessagesFrom`（DB、TDD）

**Files:**
- Modify: `src/lib/threads.ts`
- Test: `src/lib/threads.test.ts`

`citations.messageId` は `onDelete: "cascade"`（`src/lib/db/schema.ts:40`）なので、メッセージ削除で引用は自動削除される。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/threads.test.ts` の末尾（`afterAll` の後ろ、最終 `test(...)` の下）に追記:

```ts
import { deleteMessagesFrom } from "@/lib/threads";

test("deleteMessagesFrom removes turns from index onward (with citations)", async () => {
  const t = await createThread(userId, "削除テスト");
  for (const [q, a] of [["Q1", "A1[1]。"], ["Q2", "A2。"], ["Q3", "A3。"]] as const) {
    await saveCompletedMessage({
      threadId: t.id, query: q, answerText: a, tokens: 1, durationMs: 1, steps: [],
      citations: q === "Q1"
        ? [{ ordinal: 1, documentId: "d1", documentTitle: "x", chunkId: "c1", sectionId: "c1", headingPath: "h", snippet: "本文" }]
        : [],
    });
  }

  // index 1 以降（Q2, Q3）を削除 → Q1 のみ残る
  await deleteMessagesFrom(t.id, userId, 1);
  const remaining = await getThreadMessages(t.id, userId);
  expect(remaining?.map((x) => x.completed.query)).toEqual(["Q1"]);
  expect(remaining?.[0].sources[0].id).toBe("d1");
});

test("deleteMessagesFrom with index 0 clears all messages and rejects other owners", async () => {
  const t = await createThread(userId, "全削除テスト");
  await saveCompletedMessage({
    threadId: t.id, query: "X1", answerText: "X。", tokens: 1, durationMs: 1, steps: [], citations: [],
  });
  // 所有者違い → 何もしない（残る）
  await deleteMessagesFrom(t.id, "00000000-0000-0000-0000-000000000000", 0);
  const stillThere = await getThreadMessages(t.id, userId);
  expect(stillThere?.map((x) => x.completed.query)).toEqual(["X1"]);

  // 正しい所有者 + index 0 → 全削除（getThreadMessages はメッセージ無しなら title 1件を返す）
  await deleteMessagesFrom(t.id, userId, 0);
  const empty = await getThreadMessages(t.id, userId);
  expect(empty?.map((x) => x.completed.query)).toEqual(["全削除テスト"]);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test src/lib/threads.test.ts`
Expected: FAIL（`deleteMessagesFrom` が export されていない）

- [ ] **Step 3: 実装を追加**

`src/lib/threads.ts` の `import` に `inArray` を追加（既存 `import { and, desc, eq } from "drizzle-orm";` を置換）:

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
```

`getThreadMessages` 関数の直後に追加:

```ts
/** createdAt 昇順で fromIndex 番目以降のメッセージを削除する（引用は FK cascade で同時削除）。
 *  所有者が一致しない / 対象が無ければ何もしない。fromIndex<=0 で全メッセージ削除。 */
export async function deleteMessagesFrom(
  threadId: string,
  userId: string,
  fromIndex: number,
): Promise<void> {
  const [t] = await db.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
  if (!t) return;

  const rows = await db.select({ id: messages.id }).from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);

  const targets = rows.slice(Math.max(0, fromIndex)).map((r) => r.id);
  if (targets.length === 0) return;

  await db.delete(messages).where(inArray(messages.id, targets));
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/threads.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/lib/threads.ts src/lib/threads.test.ts
git commit -m "feat: スレッドの指定ターン以降を削除する deleteMessagesFrom を追加"
```

---

### Task 2: `/api/chat` に `regenerateFrom` を配線

**Files:**
- Modify: `src/app/api/chat/route.ts`

自動テストなし（チャットルートはストリーミング＋外部依存でリポジトリ上も未テスト）。truncate ロジックは Task 1 で担保済み。型チェックと Task 9 の手動確認で検証する。

- [ ] **Step 1: import に `deleteMessagesFrom` を追加**

`src/app/api/chat/route.ts:5` を置換:

```ts
import { createThread, saveCompletedMessage, getThreadMessages, deleteMessagesFrom } from "@/lib/threads";
```

- [ ] **Step 2: ボディ型に `regenerateFrom` を追加**

`src/app/api/chat/route.ts:16-18` を置換:

```ts
  const { query, threadId, model, regenerateFrom } = (await req.json().catch(() => ({}))) as {
    query?: string; threadId?: string; model?: string; regenerateFrom?: number;
  };
```

- [ ] **Step 3: 履歴読込の前に truncate**

`src/app/api/chat/route.ts:24-34` の履歴読込ブロックを置換:

```ts
  // 既存スレッドへの追記なら過去ターンを履歴として読み込む（直近8ターン窓）。
  // 再生成（regenerateFrom 指定）時は、履歴読込の前に当該index以降を削除し DB を整合させる。
  let history: ModelMessage[] = [];
  if (threadId) {
    if (typeof regenerateFrom === "number") {
      await deleteMessagesFrom(tid, claims.sub, regenerateFrom);
    }
    const prior = await getThreadMessages(tid, claims.sub);
    if (prior) {
      history = toModelHistory(
        prior.map((p) => ({ query: p.completed.query, answerText: p.completed.answerText })),
        8,
      );
    }
  }
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: /api/chat に regenerateFrom を追加し再生成時に以降ターンを削除"
```

---

### Task 3: `use-agent` の `run` に truncate / regenerateFrom オプション

**Files:**
- Modify: `src/hooks/use-agent.ts`

`run` は fetch/SSE を伴いリポジトリ上も単体テスト対象外（`reduceTurn`/`emptyTurn` のみテスト）。型チェック＋手動確認で検証。

- [ ] **Step 1: `run` のコールバック引数型を拡張**

`src/hooks/use-agent.ts:78` を置換:

```ts
      cb: { onThread?: (id: string) => void; onDone?: (id: string, status: ConvStatus) => void;
            truncateFrom?: number; regenerateFrom?: number } = {},
```

- [ ] **Step 2: `appendTurn` を truncate 対応に**

`src/hooks/use-agent.ts:84-87`（`const appendTurn = ...` ブロック）を置換:

```ts
      // 新しいターンを末尾に追加。truncateFrom 指定時はその index 以降を捨ててから追加（再生成）。
      const appendTurn = (k: string) => setConvs((prev) => {
        const turns = prev[k]?.turns ?? [];
        const base = cb.truncateFrom != null ? turns.slice(0, cb.truncateFrom) : turns;
        return { ...prev, [k]: { turns: [...base, emptyTurn(query, attachments)] } };
      });
```

- [ ] **Step 3: POST body に `regenerateFrom` を追加**

`src/hooks/use-agent.ts:112` を置換:

```ts
          body: JSON.stringify({ query, attachments, threadId, model: modelId, regenerateFrom: cb.regenerateFrom }),
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: 既存テストが壊れないことを確認**

Run: `pnpm test src/hooks/use-agent-reduce.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/hooks/use-agent.ts
git commit -m "feat: use-agent run に truncateFrom/regenerateFrom を追加"
```

---

### Task 4: 全ターン Markdown エクスポート（純関数、TDD）

**Files:**
- Create: `src/lib/export.ts`
- Test: `src/lib/export.test.ts`
- Modify: `src/components/workspace/workspace.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/export.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildThreadMarkdown } from "@/lib/export";
import type { Turn } from "@/lib/types";

function turn(partial: Partial<Turn>): Turn {
  return {
    query: "", steps: [], answer: "", streaming: false, citationMap: {},
    sourceIds: [], sources: [], tokens: 0, durationMs: 0, status: "done", attachments: [],
    ...partial,
  };
}

test("buildThreadMarkdown includes every turn's Q&A in order", () => {
  const md = buildThreadMarkdown([
    turn({ query: "組織再編の論点は？", answer: "論点は A[1]。" }),
    turn({ query: "そのリスクは？", answer: "リスクは B。" }),
  ]);
  expect(md.indexOf("組織再編の論点は？")).toBeGreaterThanOrEqual(0);
  expect(md.indexOf("そのリスクは？")).toBeGreaterThan(md.indexOf("組織再編の論点は？"));
  expect(md).toContain("論点は A[1]。");
  expect(md).toContain("リスクは B。");
});

test("buildThreadMarkdown aggregates and de-dupes sources by id", () => {
  const s = (id: string, title: string) =>
    ({ id, type: "doc" as const, title, path: `/p/${id}`, author: "", date: "", sections: [] });
  const md = buildThreadMarkdown([
    turn({ query: "Q1", answer: "A1", sources: [s("d1", "商法")] }),
    turn({ query: "Q2", answer: "A2", sources: [s("d1", "商法"), s("d2", "定款")] }),
  ]);
  // d1 は 1 回だけ、d2 も出る
  expect(md.match(/商法/g)?.length).toBe(1);
  expect(md).toContain("定款");
  expect(md).toContain("参考資料");
});

test("buildThreadMarkdown returns empty string for no turns", () => {
  expect(buildThreadMarkdown([])).toBe("");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test src/lib/export.test.ts`
Expected: FAIL（`@/lib/export` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/lib/export.ts`:

```ts
import type { Source, Turn } from "@/lib/types";

/** スレッド全ターンを Markdown 化する。各ターンの Q&A を順に並べ、出典は id で重複排除して末尾に一覧化。 */
export function buildThreadMarkdown(turns: Turn[]): string {
  if (turns.length === 0) return "";

  const body = turns
    .map((t) => `## ${t.query}\n\n${t.answer}`)
    .join("\n\n---\n\n");

  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const t of turns) {
    for (const s of t.sources) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      sources.push(s);
    }
  }

  const refs = sources.length
    ? `\n\n---\n\n## 参考資料\n${sources.map((s, i) => `[${i + 1}] ${s.title} (${s.path})`).join("\n")}\n`
    : "\n";

  return `${body}${refs}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/export.test.ts`
Expected: PASS

- [ ] **Step 5: `exportThread` を全ターン化**

`src/components/workspace/workspace.tsx` の import 群（`@/lib/utils` 付近）に追加:

```ts
import { buildThreadMarkdown } from "@/lib/export";
```

`src/components/workspace/workspace.tsx:393-401` の `exportThread` を置換:

```ts
  const exportThread = () => {
    if (turns.length === 0) {
      push("エクスポートするスレッドがありません", "info");
      return;
    }
    const md = buildThreadMarkdown(turns);
    triggerDownload(new Blob([md], { type: "text/markdown" }), `arag-thread-${activeThreadId}.md`);
    push("スレッドをMarkdownでエクスポートしました", "success");
  };
```

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/lib/export.ts src/lib/export.test.ts src/components/workspace/workspace.tsx
git commit -m "feat: スレッド全ターンを含む Markdown エクスポートに変更"
```

---

### Task 5: `workspace.tsx` の per-turn 状態・操作・配線

**Files:**
- Modify: `src/components/workspace/workspace.tsx`

- [ ] **Step 1: フィードバック状態をターンindexマップに変更**

`src/components/workspace/workspace.tsx:60` を置換:

```ts
  const [feedback, setFeedback] = useState<Record<number, "up" | "down">>({});
```

- [ ] **Step 2: フィードバックのリセット箇所を `{}` に**

以下 4 箇所の `setFeedback(null)` を `setFeedback({})` に置換する:
- `startRun` 内（`src/components/workspace/workspace.tsx:155` 付近）
- `newChat` 内（`:219` 付近）
- `deleteThread` 内アクティブ削除時（`:293` 付近）
- `selectThread` 内（`:323` 付近）

- [ ] **Step 3: `copyAnswer` を per-turn 化**

`src/components/workspace/workspace.tsx:201-209` の `copyAnswer` を置換:

```ts
  const copyAnswer = async (turnIdx: number) => {
    try {
      const text = (turns[turnIdx]?.answer ?? "").replace(/\*\*/g, "").replace(/\[\d+\]/g, "");
      await navigator.clipboard.writeText(text);
      push("回答をコピーしました", "success");
    } catch {
      push("コピーに失敗しました", "error");
    }
  };
```

- [ ] **Step 4: `startRun` を再生成対応に**

`src/components/workspace/workspace.tsx:141-185` の `startRun` を置換（差分は冒頭の引数・query/attachments 決定と、`feedback` リセット、`agent.run` のオプション）:

```ts
  const startRun = useCallback(
    async (query: string, opts?: { regenerateFrom?: number }) => {
      const regen = opts?.regenerateFrom;
      const ready = uploads.files.filter((f) => f.status === "ready");
      // 再生成: 対象ターンの query/添付を再利用。通常: 入力 or 添付からフォールバック。
      const regenTurn = regen != null ? turns[regen] : undefined;
      const finalQuery = regen != null
        ? (regenTurn?.query ?? "")
        : query || (ready.length ? "添付ファイルについて要点をまとめて" : "");
      if (!finalQuery) return;
      const attachNames = regen != null ? (regenTurn?.attachments ?? []) : ready.map((f) => f.name);

      setUserQuery(finalQuery);
      setUserAttachments(regen != null ? [] : ready);
      setComposerValue("");
      setPhase("running");
      setExpandedSteps({ t4: true, t6: true });
      setActiveSourceId("src-1");
      setHighlightSectionId("s1-2");
      setRightPanelOpen(false);
      setAutoOpened(false);
      // 再生成時は regen index 以降のフィードバックを破棄、通常は全リセット。
      setFeedback((prev) => {
        if (regen == null) return {};
        const next: Record<number, "up" | "down"> = {};
        for (const [k, v] of Object.entries(prev)) if (Number(k) < regen) next[Number(k)] = v;
        return next;
      });
      userScrolled.current = false;
      if (regen == null) uploads.clear();

      // 再生成は常にアクティブスレッドの継続。通常は完了済みスレッド表示中のみ継続。
      const cur = agent.get(activeThreadId);
      const curLast = cur?.turns[cur.turns.length - 1];
      const continueId = regen != null
        ? activeThreadId
        : (activeThreadId !== "th-current" && cur && curLast?.status !== "running" ? activeThreadId : undefined);
      if (continueId) setLiveId(continueId);

      const navAtStart = navToken.current;

      await agent.run(finalQuery, attachNames, continueId, model.id, {
        truncateFrom: regen ?? undefined,
        regenerateFrom: regen ?? undefined,
        onThread: (id) => {
          setLiveId(id);
          if (navToken.current === navAtStart) setActiveThreadId(id);
        },
        onDone: (id, status) => {
          if (status === "error") push("実行に失敗しました", "error");
          refreshThreads();
        },
      });
    },
    [agent, uploads, push, activeThreadId, refreshThreads, model, turns],
  );
```

注: `startRun` の依存配列に `turns` を追加した（再生成で `turns[regen]` を参照するため）。

- [ ] **Step 5: `regenerate` を per-turn 化**

`src/components/workspace/workspace.tsx:193-199` の `regenerate` を置換:

```ts
  const regenerate = (turnIdx: number) => {
    startRun("", { regenerateFrom: turnIdx });
    push("回答を再生成しています", "info");
  };
```

- [ ] **Step 6: `openSourcesForTurn` を追加**

`src/components/workspace/workspace.tsx` の `openCitation`（`:223-231`）の直後に追加:

```ts
  // フッターの出典チップ用: そのターンの出典でパネルを開く。
  const openSourcesForTurn = (turnIdx: number) => {
    const turn = turns[turnIdx];
    setActiveCiteTurn(turnIdx);
    setActiveSourceId(turn?.sources[0]?.id ?? "src-1");
    setHighlightSectionId(null);
    setRightPanelOpen(true);
  };
```

- [ ] **Step 7: `Transcript` への props を更新**

`src/components/workspace/workspace.tsx:623-639` の `<Transcript ... />` を置換:

```tsx
                <Transcript
                  turns={turns}
                  toolView={tweaks.toolView}
                  expandedSteps={expandedSteps}
                  onToggleStep={(id) => setExpandedSteps((m) => ({ ...m, [id]: !m[id] }))}
                  onCite={openCitation}
                  citationStyle={tweaks.citationStyle}
                  onCopy={copyAnswer}
                  onRegenerate={regenerate}
                  onOpenSources={openSourcesForTurn}
                  onFeedback={(v, idx) => {
                    setFeedback((prev) => {
                      const next = { ...prev };
                      if (next[idx] === v) delete next[idx];
                      else next[idx] = v;
                      return next;
                    });
                    if (feedback[idx] !== v) push(v === "up" ? "フィードバックを送信しました" : "改善要望を受け付けました", "success");
                  }}
                  feedback={feedback}
                  activeCiteTurn={activeCiteTurn}
                  rightPanelOpen={rightPanelShown}
                  liveAttachments={userAttachments}
                  isLiveLastTurn={isLive}
                />
```

- [ ] **Step 8: `RightPanel` に `contextQuery` を渡す**

`src/components/workspace/workspace.tsx:665-677` の `<RightPanel ... />` の props に追加（`sources={citeTurn?.sources ?? []}` の直後の行に）:

```tsx
          contextQuery={citeTurn?.query}
```

- [ ] **Step 9: 型チェック**

Run: `npx tsc --noEmit`
Expected: messages.tsx / answer-footer.tsx / right-panel.tsx の props 不一致エラーが出る（Task 6-8 で解消）。workspace.tsx 自体の構文エラーが無いことを確認。

- [ ] **Step 10: コミット**

```bash
git add src/components/workspace/workspace.tsx
git commit -m "feat: workspace を per-turn フィードバック/コピー/再生成/出典パネルに対応"
```

---

### Task 6: `messages.tsx` のフッターを全 done ターンに描画

**Files:**
- Modify: `src/components/chat/messages.tsx`

- [ ] **Step 1: `Transcript` の props 型を更新**

`src/components/chat/messages.tsx:71-88`（`export function Transcript({ ... }: { ... })` の引数分割と型）を置換:

```tsx
export function Transcript({
  turns, toolView, expandedSteps, onToggleStep, onCite, citationStyle,
  onCopy, onRegenerate, onOpenSources, onFeedback, feedback,
  activeCiteTurn, rightPanelOpen, liveAttachments, isLiveLastTurn,
}: {
  turns: Turn[];
  toolView: ToolView;
  expandedSteps: Record<string, boolean>;
  onToggleStep: (id: string) => void;
  // どのターンの引用かを特定するため turn index を渡す。
  onCite: (n: number, turnIdx: number) => void;
  citationStyle: CitationStyle;
  onCopy: (turnIdx: number) => void;
  onRegenerate: (turnIdx: number) => void;
  onOpenSources: (turnIdx: number) => void;
  onFeedback: (v: "up" | "down", turnIdx: number) => void;
  feedback: Record<number, "up" | "down">;
  activeCiteTurn: number;
  rightPanelOpen: boolean;
  liveAttachments: StagedFile[];
  isLiveLastTurn: boolean;
}) {
```

- [ ] **Step 2: フッター描画を全 done ターンに変更**

`src/components/chat/messages.tsx:112-125`（`turn.status === "cancelled" ? ...` から `AnswerFooter` ブロック末尾まで）を置換:

```tsx
              {turn.status === "cancelled" ? (
                <CancelledNotice onRetry={() => onRegenerate(idx)} />
              ) : (
                (turn.answer.length > 0 || turn.streaming) && (
                  <StreamingAnswer text={turn.answer} streaming={turn.streaming} onCite={(n) => onCite(n, idx)} citationStyle={citationStyle} />
                )
              )}
              {/* 各 done 回答が自分の指標・操作を持つ（複数ターン対応）。 */}
              {turn.status === "done" && (
                <AnswerFooter
                  tokens={turn.tokens} durationMs={turn.durationMs} sources={turn.sources}
                  onCopy={() => onCopy(idx)} onRegenerate={() => onRegenerate(idx)}
                  onOpenSources={() => onOpenSources(idx)}
                  sourcesActive={rightPanelOpen && activeCiteTurn === idx}
                  onFeedback={(v) => onFeedback(v, idx)} feedback={feedback[idx] ?? null}
                />
              )}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: answer-footer.tsx / right-panel.tsx の props 不一致のみ（Task 7-8 で解消）。messages.tsx 内のエラーが無いことを確認。

- [ ] **Step 4: コミット**

```bash
git add src/components/chat/messages.tsx
git commit -m "feat: 回答フッターを全 done ターンに表示し per-turn 操作を配線"
```

---

### Task 7: `answer-footer.tsx` の sources チップをボタン化＋アクティブ表示

**Files:**
- Modify: `src/components/chat/answer-footer.tsx`

- [ ] **Step 1: Props 型に `onOpenSources` / `sourcesActive` を追加**

`src/components/chat/answer-footer.tsx:6-14` の `interface Props` を置換:

```tsx
interface Props {
  tokens: number;
  durationMs: number;
  sources: Source[];
  onCopy: () => void;
  onRegenerate: () => void;
  onOpenSources: () => void;
  sourcesActive: boolean;
  onFeedback: (v: "up" | "down") => void;
  feedback: "up" | "down" | null;
}
```

- [ ] **Step 2: 関数引数を更新**

`src/components/chat/answer-footer.tsx:20` を置換:

```tsx
export function AnswerFooter({ tokens, durationMs, sources, onCopy, onRegenerate, onOpenSources, sourcesActive, onFeedback, feedback }: Props) {
```

- [ ] **Step 3: sources チップを button 化＋アクティブ表示**

`src/components/chat/answer-footer.tsx:37-42`（`<span className={chipCls}>` で始まる sources チップ）を置換:

```tsx
        <button
          type="button"
          onClick={onOpenSources}
          title="このターンの一次資料を表示"
          className={cn(chipCls, "cursor-pointer hover:text-fg", sourcesActive && "border-accent bg-accent-soft text-accent")}
        >
          <svg viewBox="0 0 16 16" width="11" height="11">
            <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
          {sources.length} sources
        </button>
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: right-panel.tsx の `contextQuery` props のみ未対応（Task 8 で解消）。answer-footer.tsx と messages.tsx 関連のエラーが解消していることを確認。

- [ ] **Step 5: コミット**

```bash
git add src/components/chat/answer-footer.tsx
git commit -m "feat: 出典チップをボタン化しアクティブターンを accent 表示"
```

---

### Task 8: `right-panel.tsx` ヘッダにターン文脈ラベル

**Files:**
- Modify: `src/components/sources/right-panel.tsx`

- [ ] **Step 1: Props に `contextQuery` を追加**

`src/components/sources/right-panel.tsx:9-17` の `interface Props` に追記（`sources: Source[];` の下）:

```tsx
  contextQuery?: string;
```

- [ ] **Step 2: 関数引数を更新**

`src/components/sources/right-panel.tsx:45` を置換:

```tsx
export function RightPanel({ sources, citationMap, contextQuery, activeSourceId, highlightSectionId, onSetActive, onClose, onAction }: Props) {
```

- [ ] **Step 3: ヘッダ＋文脈ラベルを 1 つのグリッドセルに包む**

親グリッドは `grid-rows-[auto_auto_auto_1fr_auto]`（`:83`）で **子要素ちょうど5個** に対応している（Head / Tabs / Meta / Body=1fr / Foot）。直接の子を増やすと `1fr` 行の割当がずれてレイアウトが壊れる。そこで Head と新しい文脈ラベルを **1 つの `<div>`（= 1 グリッドセル）** に包む。

`src/components/sources/right-panel.tsx:84-106` の Head ブロック全体（`{/* Head */}` コメントからその `</div>` 閉じまで）を、以下に置換:

```tsx
      {/* Head（+ どのターンの出典かを示す文脈ラベル）を 1 グリッドセルにまとめる。 */}
      <div>
        <div className="flex h-[52px] items-center justify-between border-b-[0.5px] border-divider px-4 max-md:px-3.5">
          <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-fg">
            <svg viewBox="0 0 16 16" width="13" height="13">
              <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <path d="M6 6h4M6 8.5h4M6 11h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span>一次資料</span>
            <span className="rounded-full bg-divider px-1.5 py-px font-mono text-[10.5px] text-muted">{sources.length}</span>
          </div>
          <div className="flex gap-0.5">
            <button className={iconBtn} title="ソースを新しいタブで開く" onClick={() => onAction("open-source", active)}>
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M6 3H3v10h10v-3M9 3h4v4M13 3l-6 6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className={iconBtn} title="閉じる" onClick={onClose}>
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        {contextQuery && (
          <div className="truncate border-b-[0.5px] border-divider px-4 py-2 text-[11.5px] text-muted max-md:px-3.5">
            「{contextQuery}」の出典
          </div>
        )}
      </div>
```

これで `contextQuery` の有無に関わらず直接の子は5個のまま保たれる。

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし（全 props 整合）

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/components/sources/right-panel.tsx
git commit -m "feat: 一次資料パネルヘッダに対象ターンの質問文脈を表示"
```

---

### Task 9: 全体検証（自動テスト＋手動確認）

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テスト**

Run: `pnpm test`
Expected: 全 PASS（既存 + Task 1/4 の新規）

- [ ] **Step 2: 型チェック＋Lint＋ビルド**

Run: `npx tsc --noEmit && pnpm lint && pnpm build`
Expected: いずれもエラーなし

- [ ] **Step 3: 手動確認（`pnpm dev`）**

ローカル DB（host:5433）に接続した状態で確認:

1. 複数ターンの会話を作る。**各 done 回答**の下に固有の指標（時間/トークン/sources）と操作（コピー/再生成/👍👎）が表示される。
2. 過去ターンの **コピー** がそのターンの本文をコピーする（最新ではない）。
3. **👍👎** が回答ごとに独立して切り替わる。スレッド切替・新規で消える。
4. 過去ターンの **再生成** → その質問が再実行され、以降のターンが画面から消える。**ページをリロード**しても破棄ターンが復活しない（DB 整合）。
5. ヘッダの **Markdown エクスポート** が全ターンの Q&A と集約出典を含む。
6. フッターの **「N sources」チップ** クリックでそのターンの出典パネルが開く。パネルヘッダに `「<質問>」の出典` が表示され、会話側のそのチップが accent でアクティブ表示になる。本文 `[n]` クリックでも同様にターンが切り替わる。

- [ ] **Step 4: 最終コミット（必要なら）**

検証で微修正が出た場合のみコミット。なければスキップ。

---

## Self-Review メモ

- **Spec カバレッジ:** 回答フッター per-turn(Task6) / フィードバック per-turn(Task5) / コピー per-turn(Task5) / 再生成＋以降破棄(Task1,2,3,5) / 全ターンエクスポート(Task4) / 出典パネル UX 案A=入口(Task7)・文脈ラベル(Task8)・アクティブ表示(Task6,7) — 全て対応。
- **型整合:** `onCopy/onRegenerate/onOpenSources: (turnIdx:number)=>void`、`onFeedback:(v,turnIdx)=>void`、`feedback: Record<number,"up"|"down">`、`AnswerFooter` の `onOpenSources/sourcesActive`、`RightPanel` の `contextQuery?` を Task5-8 で一貫使用。
- **共有ボタン:** 仕様どおり変更なし（既存 `item:null` がスレッド共有）。
- **一次資料ヘッダ件数:** 仕様どおり `citeTurn` 追従のまま（変更なし）。
