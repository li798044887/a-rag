import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AnswerFooter } from "@/components/chat/answer-footer";
import { SAMPLE_SOURCES } from "@/lib/data";

const meta = {
  title: "Chat/AnswerFooter",
  component: AnswerFooter,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: {
    tokens: 5432,
    durationMs: 4900,
    sources: SAMPLE_SOURCES,
    sourcesActive: false,
    feedback: null,
    onCopy: fn(),
    onRegenerate: fn(),
    onOpenSources: fn(),
    onFeedback: fn(),
  },
} satisfies Meta<typeof AnswerFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** ソースパネルを開いている状態（チップがアクティブ）。 */
export const SourcesActive: Story = {
  args: { sourcesActive: true },
};

/** 高評価フィードバック済み。 */
export const ThumbsUp: Story = {
  args: { feedback: "up" },
};
