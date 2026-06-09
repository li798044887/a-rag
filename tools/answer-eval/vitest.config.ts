import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// アプリの vitest.config.ts とは独立。root を tools/answer-eval に固定し、
// このツール配下のテストだけを対象にする。`@/` は src を指す。
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { environment: "node", include: ["**/*.test.ts"] },
});
