"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { AGENT_CFG_STORAGE_KEY } from "@/lib/constants";
import { AGENT_CFG_DEFAULTS, clampAgentCfg } from "@/lib/agent/config";
import type { AgentCfg } from "@/lib/types";

const AGENT_CFG_EVENT = "arag:agent-cfg";

function subscribe(onChange: () => void) {
  window.addEventListener(AGENT_CFG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(AGENT_CFG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
// 生の文字列を返してスナップショット参照を読み取り間で安定させる。
const getSnapshot = () => localStorage.getItem(AGENT_CFG_STORAGE_KEY) ?? "";
const getServerSnapshot = () => "";

/** 永続化されたエージェント挙動設定（localStorage）。chat リクエストに同梱して使う。 */
export function useAgentCfg() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const agentCfg = useMemo<AgentCfg>(() => {
    try {
      return clampAgentCfg(raw ? JSON.parse(raw) : null);
    } catch {
      return AGENT_CFG_DEFAULTS;
    }
  }, [raw]);

  const setAgentCfg = useCallback(
    <K extends keyof AgentCfg>(key: K, value: AgentCfg[K]) => {
      const current = (() => {
        try {
          return clampAgentCfg(JSON.parse(localStorage.getItem(AGENT_CFG_STORAGE_KEY) || "null"));
        } catch {
          return AGENT_CFG_DEFAULTS;
        }
      })();
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(AGENT_CFG_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      window.dispatchEvent(new Event(AGENT_CFG_EVENT));
    },
    [],
  );

  return { agentCfg, setAgentCfg };
}
