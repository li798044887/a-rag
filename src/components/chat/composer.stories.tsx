import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { fn } from "storybook/test";
import { Composer } from "@/components/chat/composer";
import { MODELS, SCOPE_PRESETS } from "@/lib/data";
import type { ScopeValue, StagedFile } from "@/lib/types";

const scope: ScopeValue = { ...SCOPE_PRESETS[0] };

const sampleAttachments: StagedFile[] = [
  { id: "f1", name: "2026Q2_roadmap.pdf", size: 1_820_000, status: "ready", progress: 100, pages: 12, chunks: 48 },
  { id: "f2", name: "meeting_notes.docx", size: 240_000, status: "processing", progress: 64 },
];

const meta = {
  title: "Chat/Composer",
  component: Composer,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: {
    value: "",
    model: MODELS[0],
    running: false,
    scope,
    attachments: [],
    onChange: fn(),
    onSubmit: fn(),
    onStop: fn(),
    onChangeModel: fn(),
    onAttachFiles: fn(),
    onRemoveAttachment: fn(),
    onChangeScope: fn(),
  },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;
type ComposerProps = ComponentProps<typeof Composer>;

function StatefulComposer({
  initialValue,
  ...args
}: ComposerProps & { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return <Composer {...args} value={value} onChange={setValue} />;
}

/** 空の状態（制御値を story 内で保持）。 */
export const Empty: Story = {
  render: (args) => <StatefulComposer {...args} initialValue="" />,
};

/** 入力済み + 添付あり。 */
export const WithAttachments: Story = {
  render: (args) => (
    <StatefulComposer
      {...args}
      initialValue="このPDFの要点を3つにまとめて"
      attachments={sampleAttachments}
    />
  ),
};

/** 実行中（停止ボタン表示）。 */
export const Running: Story = {
  args: { running: true },
  render: (args) => (
    <StatefulComposer {...args} initialValue="社内のScrum移行の経緯を調べて" />
  ),
};
