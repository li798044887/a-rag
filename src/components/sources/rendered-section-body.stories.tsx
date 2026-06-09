import type { Meta, StoryObj } from "@storybook/react-vite";
import { RenderedSectionBody } from "@/components/sources/rendered-section-body";

const meta = {
  title: "Sources/RenderedSectionBody",
  component: RenderedSectionBody,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
} satisfies Meta<typeof RenderedSectionBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 素のテキスト。 */
export const PlainText: Story = {
  args: { body: "冷却ラインCL-2で温度上昇と流量低下が同時に発生した。" },
};

/** hybrid(VLM) が図から抽出した本文。caption + mermaid + 後続プローズが 1 チャンクに
 *  混在し、mermaid ブロックは SVG 図として描画される（閉じフェンスが後続文に密着していても分割）。 */
export const FigureWithMermaid: Story = {
  args: {
    body:
      "冷却ライン CL-2 異常箇所図 図1: 冷却ラインCL-2の異常箇所。赤枠はV-12バイパス弁を示す。" +
      "T2温度上昇とF1流量低下が同時に出た場合、V-12固着を第一候補として点検する。\n" +
      "```mermaid\n" +
      "graph LR\n" +
      '    A["P-04"] --> B["HX-7 熱交換器"]\n' +
      '    B --> C["V-12"]\n' +
      '    D["T2 温度上昇センサー 赤枠: 交換候補"] -.-> E["F1 流量低下センサー"]\n' +
      '    E --> F["BT-3"]\n' +
      "```一次対応 V-12が固着している場合は、BT-3バイパスを閉じたうえでV-12を交換する。",
  },
};

/** 不正な mermaid 記法は元コードへフォールバックする。 */
export const InvalidMermaidFallsBack: Story = {
  args: { body: "```mermaid\nnot a valid diagram <<>>\n```" },
};
