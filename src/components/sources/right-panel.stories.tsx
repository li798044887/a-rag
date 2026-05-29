import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RightPanel } from "@/components/sources/right-panel";
import { SAMPLE_SOURCES, CITATION_MAP } from "@/lib/data";

const meta = {
  title: "Sources/RightPanel",
  component: RightPanel,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: {
    sources: SAMPLE_SOURCES,
    citationMap: CITATION_MAP,
    contextQuery: "Scrum 移行の決定事項",
    activeSourceId: SAMPLE_SOURCES[0].id,
    highlightSectionId: SAMPLE_SOURCES[0].sections[0]?.id ?? null,
    onSetActive: fn(),
    onClose: fn(),
    onAction: fn(),
  },
} satisfies Meta<typeof RightPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 別ソースをアクティブにした状態。 */
export const SecondSource: Story = {
  args: {
    activeSourceId: SAMPLE_SOURCES[1]?.id ?? SAMPLE_SOURCES[0].id,
    highlightSectionId: null,
  },
};
