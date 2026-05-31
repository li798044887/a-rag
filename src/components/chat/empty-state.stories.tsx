import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EmptyState } from "@/components/chat/empty-state";
import type { WorkspaceStats } from "@/lib/workspace-stats";
import type { AppUser } from "@/lib/types";

const user: AppUser = {
  name: "山田 太郎",
  firstName: "太郎",
  org: "ARag Inc.",
  initials: "YT",
  email: "taro@example.com",
};

const stats: WorkspaceStats = {
  indexedDocumentCount: 12,
  totalDocumentCount: 14,
  connectedDataSourceCount: 1,
  lastSyncedAt: "2026-05-31T08:14:00Z",
};

const meta = {
  title: "Chat/EmptyState",
  component: EmptyState,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: { user, stats, onPickPrompt: fn() },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
