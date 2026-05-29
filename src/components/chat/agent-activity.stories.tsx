import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AgentActivity } from "@/components/chat/agent-activity";
import { SAMPLE_STEPS, RUNNING_STEPS } from "@/components/chat/__fixtures__/tool-calls";

const meta = {
  title: "Chat/AgentActivity",
  component: AgentActivity,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: {
    steps: SAMPLE_STEPS,
    variant: "card",
    running: false,
    expandedMap: {},
    onToggleStep: fn(),
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["card", "timeline", "log"] },
  },
} satisfies Meta<typeof AgentActivity>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 完了後（1行サマリへ畳まれる）。 */
export const Done: Story = {};

/** 実行中（自動展開 + 現在段階インジケータ）。 */
export const Running: Story = {
  args: { steps: RUNNING_STEPS, running: true },
};
