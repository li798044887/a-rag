import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { citations, messages, threads } from "@/lib/db/schema";
import type {
  CitationMap, CompletedThread, Source, ThreadSummary, ToolCall,
} from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export async function createThread(userId: string, title: string) {
  const [row] = await db.insert(threads).values({ userId, title: title.slice(0, 80) }).returning();
  return row;
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const rows = await db.select().from(threads)
    .where(eq(threads.userId, userId))
    .orderBy(desc(threads.pinned), desc(threads.updatedAt));
  return rows.map((t) => ({
    id: t.id, title: t.title, updated: relativeTime(t.updatedAt), pinned: t.pinned,
  }));
}

export interface SaveInput {
  threadId: string;
  query: string;
  answerText: string;
  tokens: number;
  durationMs: number;
  steps: unknown[];
  citations: Array<{
    ordinal: number; documentId: string; documentTitle: string;
    chunkId: string; sectionId: string; headingPath: string; snippet: string;
  }>;
}

export async function saveCompletedMessage(input: SaveInput): Promise<void> {
  const [msg] = await db.insert(messages).values({
    threadId: input.threadId, query: input.query, answerText: input.answerText,
    tokens: input.tokens, durationMs: input.durationMs, steps: input.steps,
  }).returning();
  if (input.citations.length) {
    await db.insert(citations).values(input.citations.map((c) => ({ ...c, messageId: msg.id })));
  }
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, input.threadId));
}

export interface ThreadDetail {
  completed: CompletedThread;
  sources: Source[];
  citationMap: CitationMap;
  steps: ToolCall[];
}

/** 最新メッセージから会話スナップショットを復元（引用の denormalized 値のみ使用）。 */
export async function getThreadDetail(threadId: string, userId: string): Promise<ThreadDetail | null> {
  const [t] = await db.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
  if (!t) return null;

  const [msg] = await db.select().from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.createdAt)).limit(1);
  if (!msg) {
    return { completed: { query: t.title, answerText: "", tokens: 0, durationMs: 0 },
             sources: [], citationMap: {}, steps: [] };
  }

  const cites = await db.select().from(citations).where(eq(citations.messageId, msg.id));
  const sources = sourcesFromCitations(cites);
  const citationMap: CitationMap = {};
  for (const c of cites) citationMap[c.ordinal] = { sourceId: c.documentId, sectionId: c.sectionId };

  return {
    completed: { query: msg.query, answerText: msg.answerText, tokens: msg.tokens, durationMs: msg.durationMs },
    sources,
    citationMap,
    steps: msg.steps as ToolCall[],
  };
}

/** スレッドの全ターンを古い順に復元（各ターン = 1 完了メッセージ）。 */
export async function getThreadMessages(threadId: string, userId: string): Promise<ThreadDetail[] | null> {
  const [t] = await db.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
  if (!t) return null;

  const msgs = await db.select().from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
  if (msgs.length === 0) {
    return [{ completed: { query: t.title, answerText: "", tokens: 0, durationMs: 0 },
              sources: [], citationMap: {}, steps: [] }];
  }

  const out: ThreadDetail[] = [];
  for (const msg of msgs) {
    const cites = await db.select().from(citations).where(eq(citations.messageId, msg.id));
    const sources = sourcesFromCitations(cites);
    const citationMap: CitationMap = {};
    for (const c of cites) citationMap[c.ordinal] = { sourceId: c.documentId, sectionId: c.sectionId };
    out.push({
      completed: { query: msg.query, answerText: msg.answerText, tokens: msg.tokens, durationMs: msg.durationMs },
      sources, citationMap, steps: msg.steps as ToolCall[],
    });
  }
  return out;
}

function sourcesFromCitations(cites: Array<typeof citations.$inferSelect>): Source[] {
  const byDoc = new Map<string, Source>();
  for (const c of cites) {
    let src = byDoc.get(c.documentId);
    if (!src) {
      src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
              author: "", date: "", sections: [] };
      byDoc.set(c.documentId, src);
    }
    if (!src.sections.some((s) => s.id === c.sectionId)) {
      src.sections.push({ id: c.sectionId, heading: c.headingPath, body: c.snippet, highlight: true });
    }
  }
  return [...byDoc.values()];
}
