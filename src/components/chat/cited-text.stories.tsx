import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { CitedText } from "@/components/chat/cited-text";
import { SAMPLE_ANSWER_TEXT } from "@/lib/data";

const meta = {
  title: "Chat/CitedText",
  component: CitedText,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: {
    text: SAMPLE_ANSWER_TEXT,
    citationStyle: "numbered",
    onCite: fn(),
  },
  argTypes: {
    citationStyle: { control: "inline-radio", options: ["numbered", "chip", "pill"] },
  },
} satisfies Meta<typeof CitedText>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定の番号スタイル。引用ボタンの click が onCite を発火することを検証。 */
export const Numbered: Story = {
  args: { citationStyle: "numbered" },
  play: async ({ args, canvas, userEvent }) => {
    const cites = canvas.getAllByTitle(/引用 \d+ を開く/);
    await userEvent.click(cites[0]);
    await expect(args.onCite).toHaveBeenCalled();
  },
};

/** チップスタイルの引用。 */
export const Chip: Story = { args: { citationStyle: "chip" } };

/** ピルスタイルの引用。 */
export const Pill: Story = { args: { citationStyle: "pill" } };

/**
 * インライン画像。自社アセット(/api/documents/...)は <img> として描画し、
 * 外部 URL はセキュリティ上テキストのまま（描画しない）ことを検証する。
 */
export const InlineImage: Story = {
  args: {
    text:
      "以下の図面を示します。\n" +
      "![冷却ライン図](/api/documents/d1/assets/images/x.jpg)\n" +
      "外部画像は描画しません。\n" +
      "![外部](https://evil.example/track.jpg)",
    citationStyle: "numbered",
  },
  play: async ({ canvasElement }) => {
    const imgs = Array.from(canvasElement.querySelectorAll("img"));
    // 自社アセットは <img> として存在する（読み込み成否に関わらずマウントされる）。
    await expect(imgs.some((i) => (i.getAttribute("src") ?? "").includes("/api/documents/d1/assets/images/x.jpg"))).toBe(true);
    // 外部 URL は <img> 化されない。
    await expect(imgs.some((i) => (i.getAttribute("src") ?? "").startsWith("http"))).toBe(false);
    // 外部画像の alt はテキストとして表示される。
    await expect(canvasElement.textContent).toContain("外部");
  },
};
