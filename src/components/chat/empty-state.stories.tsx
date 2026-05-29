import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EmptyState } from "@/components/chat/empty-state";
import type { AppUser } from "@/lib/types";

const user: AppUser = {
  name: "山田 太郎",
  firstName: "太郎",
  org: "ARag Inc.",
  initials: "YT",
  email: "taro@example.com",
};

const meta = {
  title: "Chat/EmptyState",
  component: EmptyState,
  parameters: { layout: "fullscreen" },
  args: { user, onPickPrompt: fn() },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
