"use client";

import { useCallback, useRef, useState } from "react";
import { buildInitialSteps } from "@/lib/agent/steps";
import type {
  AgentEvent, CitationMap, CompletedThread, Source, ToolCall,
} from "@/lib/types";

export type ConvStatus = "running" | "done" | "cancelled" | "error";

/** 1 会話分の状態。スレッドを跨いで並行に保持できるよう threadId をキーにマップで持つ。 */
export interface ConvState {
  query: string;
  steps: ToolCall[];
  answer: string;
  streaming: boolean; // answer tokens currently arriving
  citationMap: CitationMap;
  sourceIds: string[];
  sources: Source[];
  tokens: number;
  durationMs: number;
  status: ConvStatus;
  attachments: string[];
}

/** 実 threadId が判明する前（理論上ごく短時間）に使うフォールバックキー。
 *  実際には /api/chat の X-Thread-Id ヘッダで即座に実 id が分かるためほぼ使われない。 */
export const LIVE_KEY = "th-current";

function emptyConv(query: string, attachments: string[]): ConvState {
  return {
    query, steps: [], answer: "", streaming: false, citationMap: {},
    sourceIds: [], sources: [], tokens: 0, durationMs: 0,
    status: "running", attachments,
  };
}

function reduceConv(c: ConvState, event: AgentEvent): ConvState {
  switch (event.type) {
    case "step": {
      // 既知ステップは更新、未知ステップ（初出の running）は末尾に追加 = 逐次表示。
      const exists = c.steps.some((s) => s.id === event.step.id);
      return {
        ...c,
        steps: exists
          ? c.steps.map((s) => (s.id === event.step.id ? { ...s, ...event.step } : s))
          : [...c.steps, event.step],
      };
    }
    case "answer-start":
      return { ...c, streaming: true, answer: "" };
    case "answer-delta":
      return { ...c, answer: c.answer + event.text };
    case "done":
      return {
        ...c,
        streaming: false,
        citationMap: event.citationMap,
        sourceIds: event.sourceIds,
        sources: event.sources,
        tokens: event.tokens,
        durationMs: event.durationMs,
        status: "done",
        steps: c.steps.map((s, i) =>
          i === c.steps.length - 1 ? { ...s, status: "done", summary: `回答を生成 (${event.tokens} tokens)` } : s,
        ),
      };
    case "error":
      return { ...c, streaming: false, status: "error" };
    default:
      return c;
  }
}

/** Drives agent runs over the /api/chat SSE stream, keyed by threadId.
 *
 * 各 run は自分の threadId スロットへ書き込み、他スレッドを表示しても中断されない
 * （実行中の会話は裏で継続し、いつでも戻れる）。表示は workspace が
 * activeThreadId に対応するスロットを get して描画する。 */
export function useAgent() {
  const [convs, setConvs] = useState<Record<string, ConvState>>({});
  const controllers = useRef<Record<string, AbortController>>({});

  const get = useCallback((id: string): ConvState | undefined => convs[id], [convs]);

  /** Load a finished conversation snapshot into its slot (live runs は触らない)。 */
  const loadCompleted = useCallback((id: string, detail: {
    completed: CompletedThread;
    sources: Source[];
    citationMap: CitationMap;
    steps: ToolCall[];
  }) => {
    setConvs((prev) => ({
      ...prev,
      [id]: {
        query: detail.completed.query,
        steps: detail.steps.length
          ? detail.steps.map((s) => ({ ...s, status: "done" as const }))
          : buildInitialSteps(detail.completed.query).map((s) => ({ ...s, status: "done" as const })),
        answer: detail.completed.answerText,
        streaming: false,
        citationMap: detail.citationMap,
        sourceIds: detail.sources.map((s) => s.id),
        sources: detail.sources,
        tokens: detail.completed.tokens,
        durationMs: detail.completed.durationMs,
        status: "done",
        attachments: [],
      },
    }));
  }, []);

  /** Start a live run. 実 threadId は X-Thread-Id ヘッダから取得し、その時点で
   *  onThread を呼ぶ（workspace がサイドバー登録 / アクティブ化に使う）。
   *  実行中も他スレッド表示で中断されない。 */
  const run = useCallback(
    async (
      query: string,
      attachments: string[],
      threadId: string | undefined,
      modelId: string | undefined,
      cb: { onThread?: (id: string) => void; onDone?: (id: string, status: ConvStatus) => void } = {},
    ): Promise<{ status: ConvStatus; threadId: string }> => {
      const ctrl = new AbortController();
      let key = threadId ?? LIVE_KEY;
      // 既存スレッドへの追記時のみ、その id で仮スロットを用意（onThread までの空白を防ぐ）。
      if (threadId) {
        controllers.current[key] = ctrl;
        setConvs((prev) => ({ ...prev, [key]: emptyConv(query, attachments) }));
      }

      const finish = (status: ConvStatus): { status: ConvStatus; threadId: string } => {
        setConvs((prev) => {
          const c = prev[key];
          if (!c) return prev;
          return { ...prev, [key]: { ...c, streaming: false, status: c.status === "running" ? status : c.status } };
        });
        delete controllers.current[key];
        cb.onDone?.(key, status);
        return { status, threadId: key };
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, attachments, threadId, model: modelId }),
          signal: ctrl.signal,
        });

        // 実 threadId を確定し、スロット・コントローラをそのキーへ確定する。
        const realId = res.headers.get("X-Thread-Id") || key;
        if (realId !== key) {
          controllers.current[realId] = ctrl;
          delete controllers.current[key];
          key = realId;
        } else if (!controllers.current[key]) {
          controllers.current[key] = ctrl;
        }
        setConvs((prev) => ({ ...prev, [key]: prev[key] ?? emptyConv(query, attachments) }));
        cb.onThread?.(key);

        if (!res.ok || !res.body) return finish("error");

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
            setConvs((prev) => (prev[key] ? { ...prev, [key]: reduceConv(prev[key], event) } : prev));
          }
        }
        return finish("done");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return finish("cancelled");
        return finish("error");
      }
    },
    [],
  );

  /** Cancel an in-flight run, marking its in-flight steps cancelled. */
  const cancel = useCallback((id: string) => {
    controllers.current[id]?.abort();
    setConvs((prev) => {
      const c = prev[id];
      if (!c) return prev;
      return {
        ...prev,
        [id]: {
          ...c, streaming: false, status: "cancelled",
          steps: c.steps.map((s) => (s.status === "running" ? { ...s, status: "pending", summary: "キャンセルされました" } : s)),
        },
      };
    });
  }, []);

  /** Drop a conversation slot (e.g. discard an empty/cancelled draft). */
  const remove = useCallback((id: string) => {
    controllers.current[id]?.abort();
    delete controllers.current[id];
    setConvs((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { convs, get, run, cancel, loadCompleted, remove };
}
