import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// アプリの vitest.config.ts とは独立。`@/` は src を指す。
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { environment: "node", include: ["**/*.test.ts"] },
});
