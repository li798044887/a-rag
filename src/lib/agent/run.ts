/** Server-side agent orchestrator.
 *
 * Yields a typed event stream (AgentEvent) that the /api/chat route serializes
 * as SSE. The tool steps run against the in-memory retriever for real; the
 * summarize step streams from Anthropic (via the AI SDK) when ANTHROPIC_API_KEY
 * is configured, and otherwise falls back to the curated sample answer so the
 * full flow works out of the box. */

import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { CITATION_MAP, SAMPLE_ANSWER_TEXT, SAMPLE_SOURCES } from "@/lib/data";
import { highlightSectionFor, retrieve } from "@/lib/agent/retriever";
import { buildInitialSteps } from "@/lib/agent/steps";
import type { AgentEvent, CitationMap } from "@/lib/types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RunInput {
  query: string;
  attachments?: string[];
}

export async function* runAgent({ query }: RunInput): AsyncGenerator<AgentEvent> {
  const ranked = retrieve(query);
  const top = ranked.slice(0, 4).map((r) => r.source);
  const steps = buildInitialSteps(query);
  const scaled = (ms: number) => Math.min(1100, Math.max(260, ms * 1.1));

  // ── Tool steps (all but the final summarize) ──────────────────────────
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    yield { type: "step", step: { ...step, status: "running" } };
    await sleep(scaled(step.durationMs));
    yield { type: "step", step: { ...step, status: "done" } };
    await sleep(90);
  }

  // ── Summarize (streaming answer) ──────────────────────────────────────
  const summarize = steps[steps.length - 1];
  yield { type: "step", step: { ...summarize, status: "running" } };
  yield { type: "answer-start" };

  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  let citationMap: CitationMap;
  let sourceIds: string[];
  let tokens = 428;

  if (hasKey) {
    sourceIds = top.map((s) => s.id);
    citationMap = {};
    top.forEach((s, idx) => {
      citationMap[idx + 1] = { sourceId: s.id, sectionId: highlightSectionFor(s) };
    });
    const context = top
      .map((s, idx) => `[${idx + 1}] ${s.title} (${s.path})\n${s.sections.map((x) => x.body).join("\n")}`)
      .join("\n\n");
    try {
      const result = streamText({
        model: anthropic("claude-sonnet-4-5"),
        system:
          "あなたは社内ナレッジ検索アシスタントです。提供された一次資料のみに基づき、日本語で簡潔に回答してください。" +
          "重要な事実には必ず [1] [2] のように出典番号を付けてください。Markdownの見出し(**太字**)と箇条書き(-)を使って構造化してください。",
        prompt: `一次資料:\n${context}\n\n質問: ${query}`,
      });
      let n = 0;
      for await (const delta of result.textStream) {
        n += delta.length;
        yield { type: "answer-delta", text: delta };
      }
      tokens = Math.max(120, Math.round(n / 1.8));
    } catch {
      // Fall through to the canned answer on provider error.
      for (const chunk of chunked(SAMPLE_ANSWER_TEXT)) {
        yield { type: "answer-delta", text: chunk };
        await sleep(16);
      }
    }
  } else {
    citationMap = CITATION_MAP;
    sourceIds = SAMPLE_SOURCES.map((s) => s.id);
    for (const chunk of chunked(SAMPLE_ANSWER_TEXT)) {
      yield { type: "answer-delta", text: chunk };
      await sleep(16);
    }
  }

  yield { type: "done", tokens, durationMs: 2624, citationMap, sourceIds };
}

/** Split text into small chunks so the canned answer streams like a typewriter. */
function* chunked(text: string, size = 4): Generator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}
