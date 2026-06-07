import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本番コンテナ用に最小依存の standalone 出力（.next/standalone + server.js）を生成する。
  // dev / `next start` は従来どおり動作する（ビルド出力が増えるだけ）。
  output: "standalone",
};

export default nextConfig;
