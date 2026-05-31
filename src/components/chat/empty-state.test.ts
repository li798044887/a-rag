import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EmptyState } from "@/components/chat/empty-state";
import type { AppUser } from "@/lib/types";
import type { WorkspaceStats } from "@/lib/workspace-stats";

const user: AppUser = {
  name: "山田 太郎",
  firstName: "太郎",
  org: "ARag Inc.",
  initials: "YT",
  email: "taro@example.com",
};

test("empty state shows indexed document count", () => {
  const stats: WorkspaceStats = {
    indexedDocumentCount: 12,
    totalDocumentCount: 14,
    connectedDataSourceCount: 1,
    lastSyncedAt: "2026-05-31T08:14:00Z",
  };

  const html = renderToStaticMarkup(createElement(EmptyState, {
    user,
    stats,
    onPickPrompt: () => {},
  }));

  expect(html).toContain("12");
  expect(html).toContain("ドキュメント索引中");
  expect(html).not.toContain("アップロード文書");
});
