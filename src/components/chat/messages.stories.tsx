import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { UserMessage, AssistantMessage, StaticAnswer, Transcript } from "@/components/chat/messages";
import { SAMPLE_ANSWER_TEXT, SAMPLE_SOURCES, CITATION_MAP } from "@/lib/data";
import { SAMPLE_STEPS } from "@/components/chat/__fixtures__/tool-calls";
import type { Turn } from "@/lib/types";

const meta = {
  title: "Chat/Messages",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** ユーザーの吹き出し。 */
export const User: Story = {
  render: () => <UserMessage text="先月の議事録で決まった開発プロセスの変更点を教えて" />,
};

/** アシスタント側のラッパ（任意の子を内包）。 */
export const Assistant: Story = {
  render: () => (
    <AssistantMessage>
      <p className="m-0 text-fg">これはアシスタントメッセージのコンテナです。</p>
    </AssistantMessage>
  ),
};

/** 確定済み回答テキスト（引用リンク付き）。 */
export const Answer: Story = {
  render: () => (
    <StaticAnswer text={SAMPLE_ANSWER_TEXT} citationStyle="numbered" onCite={fn()} />
  ),
};

const doneTurn: Turn = {
  query: "先月の議事録で決まった開発プロセスの変更点を教えて",
  steps: SAMPLE_STEPS,
  answer: SAMPLE_ANSWER_TEXT,
  streaming: false,
  citationMap: CITATION_MAP,
  sourceIds: SAMPLE_SOURCES.map((s) => s.id),
  sources: SAMPLE_SOURCES,
  tokens: 5432,
  durationMs: 4900,
  status: "done",
  attachments: [],
};

/** 1ターン全体（質問 → エージェント活動 → 回答 → フッター）。 */
export const FullTurn: Story = {
  render: () => (
    <Transcript
      turns={[doneTurn]}
      toolView="card"
      expandedSteps={{}}
      onToggleStep={fn()}
      onCite={fn()}
      citationStyle="numbered"
      onCopy={fn()}
      onRegenerate={fn()}
      onOpenSources={fn()}
      onFeedback={fn()}
      feedback={{}}
      activeCiteTurn={-1}
      rightPanelOpen={false}
      liveAttachments={[]}
      isLiveLastTurn={false}
    />
  ),
};
