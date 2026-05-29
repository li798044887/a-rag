import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { ConfirmModal } from "@/components/modals/confirm-modal";

const meta = {
  title: "Modals/ConfirmModal",
  component: ConfirmModal,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    title: "このスレッドを削除しますか？",
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    description: "削除すると元に戻せません。",
    confirmLabel: "削除",
    cancelLabel: "キャンセル",
  },
  // 確定ボタンの click が onConfirm を呼ぶこと（レンダーだけでは証明できない挙動）。
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "削除" }));
    await expect(args.onConfirm).toHaveBeenCalled();
  },
};

/** 破壊的操作向けの danger トーン。 */
export const Danger: Story = {
  args: {
    title: "すべてのセッションを失効しますか？",
    description: "全デバイスからログアウトされます。",
    confirmLabel: "失効する",
    tone: "danger",
  },
};

/** 説明文なし・最小構成。 */
export const TitleOnly: Story = {
  args: { title: "変更を破棄しますか？" },
};
