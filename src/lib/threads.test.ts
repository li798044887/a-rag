import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { createUser } from "@/lib/users";
import {
  createThread, listThreads, saveCompletedMessage, getThreadDetail, getThreadMessages,
  deleteMessagesFrom,
} from "@/lib/threads";

let userId: string;
const email = `thr_${Date.now()}@example.com`;

beforeAll(async () => {
  const u = await createUser({ email, password: "pw-secret-123", name: "T U" });
  userId = u.id;
});
afterAll(async () => {
  await db.execute(sql`delete from users where id = ${userId}`);
});

test("create, save message+citations, list, and reconstruct", async () => {
  const t = await createThread(userId, "認証について");
  await saveCompletedMessage({
    threadId: t.id, query: "認証について", answerText: "失効します[1]。",
    tokens: 12, durationMs: 800, steps: [{ id: "s1" }],
    citations: [{ ordinal: 1, documentId: "d1", documentTitle: "設計.pdf",
      chunkId: "c1", sectionId: "c1", headingPath: "認証", snippet: "失効する",
      blockType: "table", page: 2 }],
  });

  const list = await listThreads(userId);
  expect(list.find((x) => x.id === t.id)?.title).toBe("認証について");

  const detail = await getThreadDetail(t.id, userId);
  expect(detail?.completed.answerText).toBe("失効します[1]。");
  expect(detail?.sources[0].id).toBe("d1");
  // Task 4: blockType / page が復元される
  expect(detail?.sources[0].sections[0].blockType).toBe("table");
  expect(detail?.sources[0].sections[0].page).toBe(2);
  expect(detail?.citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
});

test("getThreadMessages returns all turns oldest-first with citations", async () => {
  const t = await createThread(userId, "履歴テスト");
  await saveCompletedMessage({
    threadId: t.id, query: "Q1", answerText: "A1[1]。", tokens: 5, durationMs: 100,
    steps: [{ id: "s1" }],
    citations: [{ ordinal: 1, documentId: "d1", documentTitle: "設計.pdf",
      chunkId: "c1", sectionId: "c1", headingPath: "h", snippet: "本文",
      blockType: "text", page: 0 }],
  });
  await saveCompletedMessage({
    threadId: t.id, query: "Q2", answerText: "A2。", tokens: 4, durationMs: 90,
    steps: [], citations: [],
  });

  const turns = await getThreadMessages(t.id, userId);
  expect(turns?.map((x) => x.completed.query)).toEqual(["Q1", "Q2"]);
  expect(turns?.[0].sources[0].id).toBe("d1");
  expect(turns?.[0].citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
});

test("deleteMessagesFrom removes turns from index onward (with citations)", async () => {
  const t = await createThread(userId, "削除テスト");
  for (const [q, a] of [["Q1", "A1[1]。"], ["Q2", "A2。"], ["Q3", "A3。"]] as const) {
    await saveCompletedMessage({
      threadId: t.id, query: q, answerText: a, tokens: 1, durationMs: 1, steps: [],
      citations: q === "Q1"
        ? [{ ordinal: 1, documentId: "d1", documentTitle: "x", chunkId: "c1", sectionId: "c1", headingPath: "h", snippet: "本文", blockType: "text", page: 0 }]
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
