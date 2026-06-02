import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { MarkdownView } from "@/components/documents/markdown-view";

const SAMPLE = `# 見出し1

本文の段落です。**強調** と \`inline code\` を含みます。

## リスト

- 項目A
- 項目B

## コード

\`\`\`
const x = 1;
\`\`\`

## 表

| 列1 | 列2 |
| --- | --- |
| a | b |
`;

const meta = {
  title: "Documents/MarkdownView",
  component: MarkdownView,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MarkdownView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { text: SAMPLE },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1, name: "見出し1" })).toBeInTheDocument();
    await expect(canvas.getByText("項目A")).toBeInTheDocument();
    await expect(canvas.getByRole("table")).toBeInTheDocument();
    await expect(canvas.getByText("const x = 1;")).toBeInTheDocument();
  },
};

export const RawHtmlNotExecuted: Story = {
  args: { text: "テキスト <script>alert(1)</script> と <b>raw</b>" },
  play: async ({ canvas, canvasElement }) => {
    // 生 HTML はエスケープされたテキストとして描画され、実要素にならないことを検証する。
    await expect(canvas.getByText(/<b>raw<\/b>/)).toBeInTheDocument();
    expect(canvasElement.querySelector("b")).toBeNull();
    expect(canvasElement.querySelector("script")).toBeNull();
  },
};
