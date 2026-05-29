import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { playwright } from "@vitest/browser-playwright";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

export default defineConfig(({ mode }) => ({
  test: {
    projects: [
      {
        // 既存のユニット/DB テスト（node 環境）。`pnpm test` のデフォルト対象。
        plugins: [tsconfigPaths()],
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          // .env.local 等を読み込んでテストへ注入する。第3引数 "" で接頭辞フィルタを外し
          // DATABASE_URL も含める（DB テストが正しい接続先 host:5433 を使えるようにする）。
          env: loadEnv(mode, process.cwd(), ""),
        },
      },
      {
        // Storybook の Story をブラウザ上で実行する（play 関数 = インタラクションテスト）。
        // preview.tsx の注釈は @storybook/addon-vitest が自動適用する。
        plugins: [tsconfigPaths(), storybookTest({ configDir: ".storybook" })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
}));
