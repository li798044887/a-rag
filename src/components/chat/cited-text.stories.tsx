import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CitedText } from "@/components/chat/cited-text";
import { SAMPLE_ANSWER_TEXT } from "@/lib/data";

const meta = {
  title: "Chat/CitedText",
  component: CitedText,
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

/** 既定の番号スタイル。 */
export const Numbered: Story = { args: { citationStyle: "numbered" } };

/** チップスタイルの引用。 */
export const Chip: Story = { args: { citationStyle: "chip" } };

/** ピルスタイルの引用。 */
export const Pill: Story = { args: { citationStyle: "pill" } };
