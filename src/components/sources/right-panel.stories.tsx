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

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** 一次資料に markdown 画像が含まれるケース（実画像が描画される）。 */
export const WithImage: Story = {
  args: {
    sources: [
      {
        id: "img-doc",
        type: "doc",
        title: "05-image-grounding-cooling-line.pdf",
        path: "05-image-grounding-cooling-line.pdf",
        author: "",
        date: "",
        sections: [
          {
            id: "sec-img",
            heading: "冷却ライン CL-2 異常報告",
            body: `T2 と F1 の同時異常を一次対応する。\n![冷却ライン図](${TINY_PNG})\n一次対応 V-12 が固着している場合は交換する。`,
            highlight: true,
            blockType: "image",
            page: 0,
          },
        ],
      },
    ],
    activeSourceId: "img-doc",
    highlightSectionId: "sec-img",
  },
};
