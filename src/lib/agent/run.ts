/** Server-side agent orchestrator (real backend).
 *
 * rewrite_query は Haiku、検索は rag /retrieve（hybrid+rerank+近傍拡張）、
 * summarize は Sonnet ストリーミング。各ステップを AgentEvent として配信する。 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";
import { retrieveChunks, type RetrievedChunk } from "@/lib/agent/retrieve-client";
import { buildInitialSteps } from "@/lib/agent/steps";
import type { AgentEvent, CitationMap, Source, ToolCall } from "@/lib/types";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  attachments?: string[];
}

export async function* runAgent({ query, ownerUserId, threadId }: RunInput): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const steps = buildInitialSteps(query);
  const byName = (name: string) => steps.find((s) => s.name === name)!;

  async function* runStep(step: ToolCall, work: () => Promise<Partial<ToolCall>>): AsyncGenerator<AgentEvent> {
    yield { type: "step", step: { ...step, status: "running" } };
    const patch = await work();
    Object.assign(step, patch, { status: "done" as const });
    yield { type: "step", step };
  }

  // 1) rewrite_query (Haiku)
  let rewritten = query;
  for await (const e of runStep(byName("rewrite_query"), async () => {
    try {
      const { text } = await generateText({
        model: anthropic("claude-haiku-4-5"),
        system: "検索意図を保ちつつ、日本語の検索クエリに簡潔に書き換えてください。説明や引用符は不要、クエリ本文のみ返答。",
        prompt: query,
      });
      rewritten = text.trim() || query;
    } catch {
      rewritten = query;
    }
    return { input: { query }, output: { rewritten }, summary: `「${rewritten}」に書き換え` };
  })) yield e;

  // 2) retrieve（1 ホップで dense/sparse/rerank/近傍拡張）
  let chunks: RetrievedChunk[] = [];
  let retrieveError = false;
  try {
    chunks = await retrieveChunks({ query, rewritten, ownerUserId, topK: 6 });
  } catch {
    retrieveError = true;
  }

  for await (const e of runStep(byName("vector_search"), async () =>
    ({ output: { backend: "qdrant", mode: "dense" }, summary: "密ベクトル検索を実行" }))) yield e;
  for await (const e of runStep(byName("bm25_search"), async () =>
    ({ output: { backend: "qdrant", mode: "sparse" }, summary: "スパース(BM25)検索を実行" }))) yield e;
  for await (const e of runStep(byName("rerank"), async () =>
    ({ output: { kept: chunks.length }, summary: `${chunks.length} 件を再順位付け` }))) yield e;
  const docCount = new Set(chunks.map((c) => c.documentId)).size;
  for await (const e of runStep(byName("fetch_document"), async () =>
    ({ output: { documents: docCount }, summary: `${docCount} 件の文書から文脈取得` }))) yield e;

  // 3) sources / citationMap を構築
  const sources = sourcesFromChunks(chunks);
  const citationMap: CitationMap = {};
  chunks.forEach((c, i) => { citationMap[i + 1] = { sourceId: c.documentId, sectionId: c.chunkId }; });
  const sourceIds = sources.map((s) => s.id);

  // 4) summarize (Sonnet streaming)
  const summarize = byName("summarize");
  yield { type: "step", step: { ...summarize, status: "running" } };
  yield { type: "answer-start" };

  let answer = "";
  if (retrieveError) {
    answer = "検索バックエンドに接続できませんでした。時間をおいて再度お試しください。";
    yield { type: "answer-delta", text: answer };
  } else if (chunks.length === 0) {
    answer = "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。";
    yield { type: "answer-delta", text: answer };
  } else {
    const context = chunks
      .map((c, i) => `[${i + 1}] ${c.documentTitle} — ${c.headingPath}\n${c.expandedText || c.text}`)
      .join("\n\n");
    const result = streamText({
      model: anthropic("claude-sonnet-4-5"),
      system:
        "あなたは社内ナレッジ検索アシスタントです。提供された一次資料のみに基づき日本語で簡潔に回答してください。" +
        "重要な事実には必ず [1] [2] のように出典番号を付け、Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。",
      prompt: `一次資料:\n${context}\n\n質問: ${query}`,
    });
    for await (const delta of result.textStream) {
      answer += delta;
      yield { type: "answer-delta", text: delta };
    }
  }

  Object.assign(summarize, { status: "done" as const, summary: "回答を生成" });
  yield { type: "step", step: summarize };

  const tokens = Math.max(1, Math.round(answer.length / 1.8));
  yield {
    type: "done",
    tokens,
    durationMs: Date.now() - started,
    citationMap,
    sourceIds,
    sources,
    threadId,
  };
}

function sourcesFromChunks(chunks: RetrievedChunk[]): Source[] {
  const byDoc = new Map<string, Source>();
  for (const c of chunks) {
    let src = byDoc.get(c.documentId);
    if (!src) {
      src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
              author: "", date: "", sections: [] };
      byDoc.set(c.documentId, src);
    }
    if (!src.sections.some((s) => s.id === c.chunkId)) {
      src.sections.push({ id: c.chunkId, heading: c.headingPath, body: c.text, highlight: true });
    }
  }
  return [...byDoc.values()];
}
