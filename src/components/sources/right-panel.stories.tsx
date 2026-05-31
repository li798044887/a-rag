import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
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

/** 長いファイル名や改行されない本文がパネル幅を押し広げないことを確認するケース。 */
export const LongContent: Story = {
  args: {
    sources: [
      {
        id: "long-doc",
        type: "doc",
        title: "06-multi-file-requirement-request-with-very-long-unbroken-vendor-security-appendix-2026-05-19.pdf",
        path: "documents/procurement/security/2026/05/06-multi-file-requirement-request-with-very-long-unbroken-vendor-security-appendix-2026-05-19.pdf",
        author: "",
        date: "",
        sections: [
          {
            id: "long-sec",
            heading: "SUNTECH_PURCHASE_REQUEST_緊急購買要求_エッジAIゲートウェイ設備保全_very_long_unbroken_heading_segment",
            body: `SUNTECH PURCHASE REQUEST緊急購買要求: エッジAIゲートウェイ設備保全 2026-0519 / 申請者: 保全部1. 必須要件納期は2026-06-07まで。これを超える場合は不採用。AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n<table><tr><th>項目</th><th>値</th></tr><tr><td>長い識別子</td><td>edge-ai-gateway-procurement-requirement-security-local-inference-no-cloud-transfer-log-retention-365-days-iso27001-soc2-contract-2026-05-19-final</td></tr></table>`,
            highlight: true,
            page: 0,
          },
        ],
      },
    ],
    activeSourceId: "long-doc",
    highlightSectionId: "long-sec",
  },
};

/** 数式チャンクは HTML整形で KaTeX 表示し、解析テキストへ切り替えると生テキストを確認できる。 */
export const EquationModes: Story = {
  args: {
    sources: [
      {
        id: "eq-doc",
        type: "doc",
        title: "equations.pdf",
        path: "equations.pdf",
        author: "",
        date: "",
        sections: [
          {
            id: "eq-sec",
            heading: "熱収支式",
            body: "\\frac{Q}{A}=h(T_s-T_\\infty)",
            highlight: true,
            blockType: "equation",
            page: 0,
          },
        ],
      },
    ],
    citationMap: { 1: { sourceId: "eq-doc", sectionId: "eq-sec" } },
    activeSourceId: "eq-doc",
    highlightSectionId: "eq-sec",
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(canvas.getByRole("button", { name: "HTML整形" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "解析テキスト" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "元PDF" })).toBeInTheDocument();
    await expect(canvasElement.querySelector(".katex-display")).not.toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "解析テキスト" }));
    await expect(canvasElement.querySelector(".katex-display")).toBeNull();
    await expect(canvasElement.textContent).toContain("\\frac{Q}{A}");
  },
};
