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
  // `@/` エイリアスを tsconfig の paths から解決する（next 非依存で動かすため）。
  viteFinal: async (cfg) => {
    const { default: tsconfigPaths } = await import("vite-tsconfig-paths");
    cfg.plugins = cfg.plugins ?? [];
    cfg.plugins.push(tsconfigPaths());
    return cfg;
  },
};

export default config;
