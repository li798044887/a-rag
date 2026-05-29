import type { Meta, StoryObj } from "@storybook/react-vite";
import { HtmlTable } from "@/components/sources/html-table";

const sampleHtml = `
<table>
  <thead>
    <tr><th>四半期</th><th>売上 (百万円)</th><th>前年比</th></tr>
  </thead>
  <tbody>
    <tr><td>2026 Q1</td><td>1,240</td><td>+12%</td></tr>
    <tr><td>2026 Q2</td><td>1,380</td><td>+18%</td></tr>
    <tr><td>2026 Q3</td><td>1,510</td><td>+9%</td></tr>
  </tbody>
</table>`;

const meta = {
  title: "Sources/HtmlTable",
  component: HtmlTable,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: { html: sampleHtml },
} satisfies Meta<typeof HtmlTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
