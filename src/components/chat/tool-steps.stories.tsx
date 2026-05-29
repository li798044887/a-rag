import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ToolSteps } from "@/components/chat/tool-steps";
import { SAMPLE_STEPS } from "@/components/chat/__fixtures__/tool-calls";

const meta = {
  title: "Chat/ToolSteps",
  component: ToolSteps,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: {
    steps: SAMPLE_STEPS,
    // 全ステップを展開した状態で詳細レンダリングを確認。
    expandedMap: Object.fromEntries(SAMPLE_STEPS.map((s) => [s.id, true])),
    onToggleStep: fn(),
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["card", "timeline", "log"] },
  },
} satisfies Meta<typeof ToolSteps>;

export default meta;
type Story = StoryObj<typeof meta>;

/** カード表示。 */
export const Card: Story = { args: { variant: "card" } };

/** タイムライン表示（親 retrieve 配下にサブステップ）。 */
export const Timeline: Story = { args: { variant: "timeline" } };

/** ログ表示。 */
export const Log: Story = { args: { variant: "log" } };
