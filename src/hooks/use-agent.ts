"use client";

import { useCallback, useRef, useState } from "react";
import { buildInitialSteps } from "@/lib/agent/steps";
import type {
  AgentEvent, CitationMap, CompletedThread, Source, ToolCall,
} from "@/lib/types";

interface AgentState {
  steps: ToolCall[];
  answer: string;
  streaming: boolean; // answer tokens currently arriving
  citationMap: CitationMap;
  sourceIds: string[];
  sources: Source[];
  threadId: string;
  tokens: number;
  durationMs: number;
}

const EMPTY: AgentState = {
  steps: [],
  answer: "",
  streaming: false,
  citationMap: {},
  sourceIds: [],
  sources: [],
  threadId: "",
  tokens: 0,
  durationMs: 0,
};

/** Drives a live agent run over the /api/chat SSE stream and exposes the
 * reconstructed step list + streamed answer. Also loads pre-baked threads. */
export function useAgent() {
  const [state, setState] = useState<AgentState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(EMPTY);
  }, []);

  /** Load a finished conversation snapshot from the API. */
  const loadCompleted = useCallback((detail: {
    completed: CompletedThread;
    sources: Source[];
    citationMap: CitationMap;
    steps: ToolCall[];
  }) => {
    abortRef.current?.abort();
    setState({
      steps: detail.steps.length
        ? detail.steps.map((s) => ({ ...s, status: "done" as const }))
        : buildInitialSteps(detail.completed.query).map((s) => ({ ...s, status: "done" as const })),
      answer: detail.completed.answerText,
      streaming: false,
      citationMap: detail.citationMap,
      sourceIds: detail.sources.map((s) => s.id),
      sources: detail.sources,
      threadId: "",
      tokens: detail.completed.tokens,
      durationMs: detail.completed.durationMs,
    });
  }, []);

  /** Start a live run. Resolves to a status plus the resolved threadId
   * (captured from the `done` event — avoids reading stale hook state). */
  const run = useCallback(
    async (
      query: string,
      attachments: string[] = [],
      threadId?: string,
      modelId?: string,
    ): Promise<{ status: "done" | "cancelled" | "error"; threadId?: string }> => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // 逐次表示: 送信直後は空。step イベント到着順にカードを追加する（skeleton 先出しはしない）。
      setState({ ...EMPTY, answer: "", streaming: false });

      let doneThreadId: string | undefined;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, attachments, threadId, model: modelId }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) return { status: "error" };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5).trim()) as AgentEvent;
            if (event.type === "done") doneThreadId = event.threadId;
            applyEvent(setState, event);
          }
        }
        return { status: "done", threadId: doneThreadId };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return { status: "cancelled" };
        return { status: "error" };
      }
    },
    [],
  );

  /** Freeze the current run: mark in-flight steps cancelled. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({
      ...prev,
      streaming: false,
      steps: prev.steps.map((s) =>
        s.status === "running" ? { ...s, status: "pending", summary: "キャンセルされました" } : s,
      ),
    }));
  }, []);

  return { ...state, run, cancel, reset, loadCompleted };
}

function applyEvent(
  setState: React.Dispatch<React.SetStateAction<AgentState>>,
  event: AgentEvent,
) {
  switch (event.type) {
    case "step":
      // 既知ステップは更新、未知ステップ（初出の running）は末尾に追加 = 逐次表示。
      setState((prev) => {
        const exists = prev.steps.some((s) => s.id === event.step.id);
        return {
          ...prev,
          steps: exists
            ? prev.steps.map((s) => (s.id === event.step.id ? { ...s, ...event.step } : s))
            : [...prev.steps, event.step],
        };
      });
      break;
    case "answer-start":
      setState((prev) => ({ ...prev, streaming: true, answer: "" }));
      break;
    case "answer-delta":
      setState((prev) => ({ ...prev, answer: prev.answer + event.text }));
      break;
    case "done":
      setState((prev) => ({
        ...prev,
        streaming: false,
        citationMap: event.citationMap,
        sourceIds: event.sourceIds,
        sources: event.sources,
        threadId: event.threadId,
        tokens: event.tokens,
        durationMs: event.durationMs,
        // Flip the summarize step to done.
        steps: prev.steps.map((s, i) =>
          i === prev.steps.length - 1 ? { ...s, status: "done", summary: `回答を生成 (${event.tokens} tokens)` } : s,
        ),
      }));
      break;
    case "error":
      setState((prev) => ({ ...prev, streaming: false }));
      break;
  }
}
