import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BrandMark, Icon, type IconName } from "@/components/icons";

const ICON_NAMES: IconName[] = [
  "search", "plus", "close", "check", "chevronDown", "chevronLeft", "chevronRight",
  "external", "brain", "folders", "sliders", "cog", "shield", "user", "signout",
  "star", "folder", "layers", "globe", "book", "doc", "chat", "hash", "meeting",
  "code", "table", "target", "paperclip", "database", "inbox", "confluence",
  "notion", "drive", "slack", "github", "postgres", "linear", "filePdf", "fileDoc",
  "fileSheet", "fileSlide", "fileImage", "fileCode", "fileText", "fileGeneric",
  "copy", "download", "share", "refresh", "thumbsUp", "thumbsDown", "stop", "send",
  "arrowUp", "menu", "more", "pencil", "trash", "starFilled", "sun", "moon",
  "clock", "info", "alert", "lock", "group", "link", "bookmark", "spark",
];

const meta = {
  title: "Foundations/Icons",
  component: Icon,
  tags: ["ai-generated"],
  parameters: { layout: "centered" },
  // render のみの Story でも必須 arg を満たすため meta レベルで既定値を持つ。
  args: { name: "search", size: 24 },
  argTypes: {
    name: { control: "select", options: ICON_NAMES },
    size: { control: { type: "range", min: 12, max: 64, step: 2 } },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 単一アイコン。ツールバーで name / size を切り替え可能。 */
export const Single: Story = {
  args: { name: "search", size: 24, className: "text-fg" },
};

/** 全グリフ一覧。currentColor 追従なので親の文字色でティントされる。 */
export const Gallery: Story = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 p-4 text-fg">
      {ICON_NAMES.map((name) => (
        <div
          key={name}
          className="flex flex-col items-center gap-2 rounded-lg border border-divider bg-surface p-3"
        >
          <Icon name={name} size={22} />
          <span className="text-[10px] text-muted">{name}</span>
        </div>
      ))}
    </div>
  ),
};

/** プロジェクト唯一の CSS ロード検証。globals.css の `--accent` が効いていれば
 *  `bg-accent` タイルは #3fa77e = rgb(63, 167, 126) に解決される。
 *  これが失敗する＝共有 preview が CSS を読み込めていない、ということ。 */
export const CssCheck: Story = {
  render: () => (
    <div
      data-testid="accent-tile"
      className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-white"
    >
      <BrandMark size={24} />
    </div>
  ),
  play: async ({ canvas }) => {
    const tile = canvas.getByTestId("accent-tile");
    await expect(getComputedStyle(tile).backgroundColor).toBe("rgb(63, 167, 126)");
  },
};

/** ブランドマーク（24×24）。アクセントタイル上での見え方を確認。 */
export const Brand: Story = {
  render: () => (
    <div className="flex items-center gap-6 p-4">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-white shadow-[0_6px_20px_var(--accent-glow)]">
        <BrandMark size={24} />
      </div>
      <BrandMark size={40} className="text-accent" />
      <BrandMark size={28} className="text-fg" />
    </div>
  ),
};
