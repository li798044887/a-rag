import { expect, test } from "vitest";
import { formatLastSynced, normalizeWorkspaceStats } from "@/lib/workspace-stats";

test("normalizeWorkspaceStats clamps invalid counts and preserves timestamps", () => {
  expect(normalizeWorkspaceStats({
    indexed_document_count: -2,
    total_document_count: 3,
    connected_data_source_count: 1.8,
    last_synced_at: "2026-05-31T08:14:00Z",
  })).toEqual({
    indexedDocumentCount: 0,
    totalDocumentCount: 3,
    connectedDataSourceCount: 1,
    lastSyncedAt: "2026-05-31T08:14:00Z",
  });
});

test("formatLastSynced renders a short Japanese relative time", () => {
  const now = new Date("2026-05-31T08:16:30Z");
  expect(formatLastSynced("2026-05-31T08:14:00Z", "ja", now)).toBe("2分前");
  expect(formatLastSynced(null, "ja", now)).toBe("未同期");
});

test("formatLastSynced renders a short Chinese relative time", () => {
  const now = new Date("2026-05-31T08:16:30Z");
  expect(formatLastSynced("2026-05-31T08:14:00Z", "zh", now)).toBe("2分钟前");
  expect(formatLastSynced(null, "zh", now)).toBe("未同步");
});
