import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { createUser } from "@/lib/users";
import {
  createThread, listThreads, saveCompletedMessage, getThreadDetail, getThreadMessages,
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
      chunkId: "c1", sectionId: "c1", headingPath: "認証", snippet: "失効する" }],
  });

  const list = await listThreads(userId);
  expect(list.find((x) => x.id === t.id)?.title).toBe("認証について");

  const detail = await getThreadDetail(t.id, userId);
  expect(detail?.completed.answerText).toBe("失効します[1]。");
  expect(detail?.sources[0].id).toBe("d1");
  expect(detail?.citationMap[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
});

test("getThreadMessages returns all turns oldest-first with citations", async () => {
  const t = await createThread(userId, "履歴テスト");
  await saveCompletedMessage({
    threadId: t.id, query: "Q1", answerText: "A1[1]。", tokens: 5, durationMs: 100,
    steps: [{ id: "s1" }],
    citations: [{ ordinal: 1, documentId: "d1", documentTitle: "設計.pdf",
      chunkId: "c1", sectionId: "c1", headingPath: "h", snippet: "本文" }],
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
