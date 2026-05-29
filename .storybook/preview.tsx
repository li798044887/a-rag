import type { Preview } from "@storybook/react-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
// アプリ本体と同じトークン/テーマ/アニメーションを読み込む（Tailwind v4 は
// ルートの postcss.config.mjs 経由で処理される）。
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    a11y: { test: "todo" },
  },
  // ツールバーから light / dark を切り替え。アプリは <html> に theme-* を付与する
  // ので同じ仕組みに合わせる。
  decorators: [
    withThemeByClassName({
      themes: { light: "theme-light", dark: "theme-dark" },
      defaultTheme: "light",
    }),
  ],
};

export default preview;
