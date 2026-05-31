export interface WorkspaceStats {
  indexedDocumentCount: number;
  totalDocumentCount: number;
  connectedDataSourceCount: number;
  lastSyncedAt: string | null;
}

export interface WorkspaceStatsPayload {
  indexed_document_count?: unknown;
  total_document_count?: unknown;
  connected_data_source_count?: unknown;
  last_synced_at?: unknown;
}

const intCount = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

export function normalizeWorkspaceStats(payload: WorkspaceStatsPayload): WorkspaceStats {
  return {
    indexedDocumentCount: intCount(payload.indexed_document_count),
    totalDocumentCount: intCount(payload.total_document_count),
    connectedDataSourceCount: intCount(payload.connected_data_source_count),
    lastSyncedAt: typeof payload.last_synced_at === "string" ? payload.last_synced_at : null,
  };
}

export function formatLastSynced(value: string | null, now = new Date()): string {
  if (!value) return "未同期";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "未同期";
  const diff = Math.max(0, now.getTime() - t);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}日前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}ヶ月前`;
  return `${Math.floor(months / 12)}年前`;
}
