import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  // ドメイン別ディレクトリ（src/components/**）に colocate した *.stories.tsx を拾う。
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // MSW の Service Worker（public/mockServiceWorker.js）を配信する。
  staticDirs: ["../public"],
  // `@/` エイリアスは Vite ネイティブの tsconfig paths 解決を使う（next 非依存で動かすため）。
  viteFinal: async (cfg) => {
    cfg.resolve = { ...cfg.resolve, tsconfigPaths: true };
    return cfg;
  },
};

export default config;
