"use client";

import { useCallback, useRef, useState } from "react";
import { buildInitialSteps } from "@/lib/agent/steps";
import { CITATION_MAP, SAMPLE_SOURCES } from "@/lib/data";
import type { AgentEvent, CitationMap, CompletedThread, ToolCall } from "@/lib/types";

interface AgentState {
  steps: ToolCall[];
  answer: string;
  streaming: boolean; // answer tokens currently arriving
  citationMap: CitationMap;
  sourceIds: string[];
  tokens: number;
  durationMs: number;
}

const EMPTY: AgentState = {
  steps: [],
  answer: "",
  streaming: false,
  citationMap: CITATION_MAP,
  sourceIds: SAMPLE_SOURCES.map((s) => s.id),
  tokens: 428,
  durationMs: 2624,
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

  /** Load a finished, pre-baked conversation snapshot (no network). */
  const loadCompleted = useCallback((thread: CompletedThread) => {
    abortRef.current?.abort();
    setState({
      steps: buildInitialSteps(thread.query).map((s) => ({ ...s, status: "done" })),
      answer: thread.answerText,
      streaming: false,
      citationMap: CITATION_MAP,
      sourceIds: SAMPLE_SOURCES.map((s) => s.id),
      tokens: thread.tokens,
      durationMs: thread.durationMs,
    });
  }, []);

  /** Start a live run. Resolves to "done" | "cancelled" | "error". */
  const run = useCallback(
    async (query: string, attachments: string[] = []): Promise<"done" | "cancelled" | "error"> => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setState({ ...EMPTY, steps: buildInitialSteps(query), answer: "", streaming: false });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, attachments }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) return "error";

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
            applyEvent(setState, event);
          }
        }
        return "done";
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
        return "error";
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
      setState((prev) => ({
        ...prev,
        steps: prev.steps.map((s) => (s.id === event.step.id ? { ...s, ...event.step } : s)),
      }));
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
