import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ToastViewport } from "@/components/feedback/toast-viewport";
import type { Toast } from "@/lib/types";

const toasts: Toast[] = [
  { id: "t1", kind: "success", msg: "リンクをコピーしました" },
  { id: "t2", kind: "info", msg: "3件のドキュメントを取り込み中…" },
  { id: "t3", kind: "error", msg: "アップロードに失敗しました" },
];

const meta = {
  title: "Feedback/ToastViewport",
  component: ToastViewport,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: { toasts, onDismiss: fn() },
} satisfies Meta<typeof ToastViewport>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllKinds: Story = {};

export const SingleSuccess: Story = {
  args: { toasts: [{ id: "t1", kind: "success", msg: "保存しました" }] },
};
