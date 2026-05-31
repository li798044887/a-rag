"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentEvent, Turn } from "@/lib/types";

export type ConvStatus = "running" | "done" | "cancelled" | "error";

/** スレッドの会話状態 = ターンの配列。 */
export interface ConvState {
  turns: Turn[];
}

export const LIVE_KEY = "th-current";
export const PENDING_THREAD_PREFIX = `${LIVE_KEY}:pending:`;

export function isPendingThreadId(id: string): boolean {
  return id.startsWith(PENDING_THREAD_PREFIX);
}

export function emptyTurn(query: string, attachments: string[]): Turn {
  return {
    query, steps: [], answer: "", streaming: false, citationMap: {},
    sourceIds: [], sources: [], tokens: 0, durationMs: 0,
    status: "running", attachments,
  };
}

export function appendRunTurn(
  prev: Record<string, ConvState>,
  key: string,
  query: string,
  attachments: string[],
  truncateFrom: number | undefined,
): Record<string, ConvState> {
  const turns = prev[key]?.turns ?? [];
  const base = truncateFrom != null ? turns.slice(0, truncateFrom) : turns;
  return { ...prev, [key]: { turns: [...base, emptyTurn(query, attachments)] } };
}

export function moveConversation(
  prev: Record<string, ConvState>,
  from: string,
  to: string,
  fallbackTurn: Turn,
): Record<string, ConvState> {
  const moved = prev[from]?.turns ?? [];
  const existing = from === to ? [] : (prev[to]?.turns ?? []);
  const merged = [...existing, ...moved];
  const next = { ...prev };
  delete next[from];
  next[to] = { turns: merged.length ? merged : [fallbackTurn] };
  return next;
}

/** 1ターンに対する AgentEvent の畳み込み（純関数・テスト対象）。 */
export function reduceTurn(t: Turn, event: AgentEvent): Turn {
  switch (event.type) {
    case "step": {
      const exists = t.steps.some((s) => s.id === event.step.id);
      return {
        ...t,
        steps: exists
          ? t.steps.map((s) => (s.id === event.step.id ? { ...s, ...event.step } : s))
          : [...t.steps, event.step],
      };
    }
    case "answer-start":
      return { ...t, streaming: true, answer: "" };
    case "answer-delta":
      return { ...t, answer: t.answer + event.text };
    case "done":
      return {
        ...t, streaming: false, citationMap: event.citationMap, sourceIds: event.sourceIds,
        sources: event.sources, tokens: event.tokens, durationMs: event.durationMs, status: "done",
      };
    case "error":
      return { ...t, streaming: false, status: "error" };
    default:
      return t;
  }
}

/** Drives agent runs over the /api/chat SSE stream, keyed by threadId.
 *  各スレッドは turns 配列を保持し、新しい run は末尾ターンへ畳み込む。 */
export function useAgent() {
  const [convs, setConvs] = useState<Record<string, ConvState>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const pendingSeq = useRef(0);

  const get = useCallback((id: string): ConvState | undefined => convs[id], [convs]);

  /** 完了済みスレッドの全ターンを slot へロード（live runs は触らない）。 */
  const loadCompleted = useCallback((id: string, turns: Turn[]) => {
    setConvs((prev) => ({ ...prev, [id]: { turns } }));
  }, []);

  /** 末尾ターンへ event を畳み込む helper。 */
  const applyToLastTurn = (state: ConvState | undefined, event: AgentEvent): ConvState => {
    const turns = state?.turns ?? [];
    if (turns.length === 0) return { turns };
    const last = turns[turns.length - 1];
    return { turns: [...turns.slice(0, -1), reduceTurn(last, event)] };
  };

  const run = useCallback(
    async (
      query: string,
      attachments: string[],
      threadId: string | undefined,
      modelId: string | undefined,
      cb: { onPendingThread?: (id: string) => void; onThread?: (id: string, previousId?: string) => void; onDone?: (id: string, status: ConvStatus) => void;
            truncateFrom?: number; regenerateFrom?: number } = {},
    ): Promise<{ status: ConvStatus; threadId: string }> => {
      const ctrl = new AbortController();
      const pendingKey = threadId ? null : `${PENDING_THREAD_PREFIX}${++pendingSeq.current}`;
      let key = threadId ?? pendingKey!;

      // 楽観的に新しいターンを即追加（新規は run ごとの pending key、既存はそのスレッドへ）。
      // 新規スレッドの実 id 確定（X-Thread-Id）までの本文空白フラッシュを防ぐ。
      controllers.current[key] = ctrl;
      setConvs((prev) => appendRunTurn(prev, key, query, attachments, cb.truncateFrom));
      if (pendingKey) cb.onPendingThread?.(pendingKey);

      const finish = (status: ConvStatus): { status: ConvStatus; threadId: string } => {
        setConvs((prev) => {
          const c = prev[key];
          if (!c || c.turns.length === 0) return prev;
          const last = c.turns[c.turns.length - 1];
          const nextLast = { ...last, streaming: false,
            status: last.status === "running" ? status : last.status };
          return { ...prev, [key]: { turns: [...c.turns.slice(0, -1), nextLast] } };
        });
        delete controllers.current[key];
        cb.onDone?.(key, status);
        return { status, threadId: key };
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, attachments, threadId, model: modelId, regenerateFrom: cb.regenerateFrom }),
          signal: ctrl.signal,
        });

        const realId = res.headers.get("X-Thread-Id") || key;
        if (realId !== key) {
          const previousKey = key;
          controllers.current[realId] = ctrl;
          delete controllers.current[key];
          // 仮キーのターンだけを実キーへ移す。下書きキーの残存ターンは混ぜない。
          setConvs((prev) => moveConversation(prev, previousKey, realId, emptyTurn(query, attachments)));
          key = realId;
          cb.onThread?.(key, previousKey);
        } else {
          if (!controllers.current[key]) controllers.current[key] = ctrl;
          setConvs((prev) => (prev[key]?.turns.length ? prev : { ...prev, [key]: { turns: [emptyTurn(query, attachments)] } }));
          cb.onThread?.(key);
        }

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
            setConvs((prev) => ({ ...prev, [key]: applyToLastTurn(prev[key], event) }));
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

  const cancel = useCallback((id: string) => {
    controllers.current[id]?.abort();
    setConvs((prev) => {
      const c = prev[id];
      if (!c || c.turns.length === 0) return prev;
      const last = c.turns[c.turns.length - 1];
      const nextLast = { ...last, streaming: false, status: "cancelled" as const,
        steps: last.steps.map((s) => (s.status === "running"
          ? { ...s, status: "pending" as const, summary: "キャンセルされました" } : s)) };
      return { ...prev, [id]: { turns: [...c.turns.slice(0, -1), nextLast] } };
    });
  }, []);

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
