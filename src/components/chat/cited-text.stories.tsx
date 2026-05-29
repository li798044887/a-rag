import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { CitedText } from "@/components/chat/cited-text";
import { SAMPLE_ANSWER_TEXT } from "@/lib/data";

const meta = {
  title: "Chat/CitedText",
  component: CitedText,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: {
    text: SAMPLE_ANSWER_TEXT,
    citationStyle: "numbered",
    onCite: fn(),
  },
  argTypes: {
    citationStyle: { control: "inline-radio", options: ["numbered", "chip", "pill"] },
  },
} satisfies Meta<typeof CitedText>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定の番号スタイル。引用ボタンの click が onCite を発火することを検証。 */
export const Numbered: Story = {
  args: { citationStyle: "numbered" },
  play: async ({ args, canvas, userEvent }) => {
    const cites = canvas.getAllByTitle(/引用 \d+ を開く/);
    await userEvent.click(cites[0]);
    await expect(args.onCite).toHaveBeenCalled();
  },
};

/** チップスタイルの引用。 */
export const Chip: Story = { args: { citationStyle: "chip" } };

/** ピルスタイルの引用。 */
export const Pill: Story = { args: { citationStyle: "pill" } };
