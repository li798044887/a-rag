import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => ({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // .env.local 等を読み込んでテストへ注入する。第3引数 "" で接頭辞フィルタを外し
    // DATABASE_URL も含める（DB テストが正しい接続先 host:5433 を使えるようにする）。
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
