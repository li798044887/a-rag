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

// 列数が多くパネル幅に収まらない表（はみ出しケース）。
const wideHtml = `
<table>
  <thead>
    <tr><th>設備ID</th><th>振動</th><th>温度</th><th>電流</th><th>暫定判定</th><th>注記コード</th><th>部品到着予定</th><th>備考メモ欄</th></tr>
  </thead>
  <tbody>
    <tr><td>MX-11</td><td>0.42</td><td>0.55</td><td>0.37</td><td>監視継続</td><td>N1</td><td>在庫あり即時</td><td>特記事項なし</td></tr>
    <tr><td>MX-17</td><td>0.91</td><td>0.88</td><td>0.74</td><td>停止候補</td><td>N9</td><td>翌営業日AM到着</td><td>夜間停止枠まで継続</td></tr>
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

/** 幅に収まらない表。右フェードと拡大ボタンが出て、シートが開閉できる。 */
export const WideOverflow: Story = {
  args: { html: wideHtml },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
};
