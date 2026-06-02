import type { Preview } from "@storybook/react-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
import { initialize, mswLoader } from "msw-storybook-addon";
import MockDate from "mockdate";
import { THEME_STORAGE_KEY } from "@/lib/constants";
import { LocaleProvider } from "@/i18n/context";
import { getDictionary } from "@/i18n/dictionary";
import { mswHandlers } from "./msw-handlers";
// アプリ本体と同じトークン/テーマ/アニメーションを読み込む（Tailwind v4 は
// ルートの postcss.config.mjs 経由で処理される）。
import "../src/app/globals.css";

initialize({ onUnhandledRequest: "bypass" });

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    a11y: { test: "todo" },
    msw: { handlers: mswHandlers },
  },
  loaders: [mswLoader],
  // ツールバーから light / dark を切り替え。アプリは <html> に theme-* を付与する
  // ので同じ仕組みに合わせる。
  decorators: [
    // 既存ストーリーは日本語 UI を前提にアサートしているため、辞書は ja を既定にする。
    // useT() を使うコンポーネントはこの Provider 配下でないと throw するので全体に適用する。
    (Story) => (
      <LocaleProvider locale="ja" dict={getDictionary("ja")}>
        <Story />
      </LocaleProvider>
    ),
    withThemeByClassName({
      themes: { light: "theme-light", dark: "theme-dark" },
      defaultTheme: "light",
    }),
  ],
  async beforeEach() {
    // use-tweaks が読む唯一の永続キーのみ seed する（全消去はしない）。
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ dark: false }));
    // EmptyState の挨拶は時刻依存なので固定する（昼 =「こんにちは」）。
    MockDate.set("2026-04-01T12:00:00");
  },
};

export default preview;
