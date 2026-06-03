import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { PlainTextView } from "@/components/documents/plain-text-view";

const meta = {
  title: "Documents/PlainTextView",
  component: PlainTextView,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlainTextView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { text: "1行目\n2行目\n  インデント付き\n長い行のサンプルテキストです。" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/1行目/)).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { text: "   \n  " },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("表示できる内容がありません")).toBeInTheDocument();
  },
};
