"use client";

import { useCallback, useEffect, useState } from "react";
import { normalizeWorkspaceStats, type WorkspaceStats, type WorkspaceStatsPayload } from "@/lib/workspace-stats";

const EMPTY_STATS: WorkspaceStats = {
  indexedDocumentCount: 0,
  totalDocumentCount: 0,
  connectedDataSourceCount: 0,
  lastSyncedAt: null,
};

export function useWorkspaceStats(enabled: boolean) {
  const [stats, setStats] = useState<WorkspaceStats>(EMPTY_STATS);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const res = await fetch("/api/documents/stats").catch(() => null);
    if (!res?.ok) return;
    const payload = (await res.json()) as WorkspaceStatsPayload;
    setStats(normalizeWorkspaceStats(payload));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);

  return { stats, refresh };
}
