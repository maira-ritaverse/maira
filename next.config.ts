import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF 生成で puppeteer-core + @sparticuz/chromium-min をサーバー側で使う。
  // Next.js の bundler に取り込ませると、内部の動的 require / ネイティブ参照が
  // 壊れる(特に chromium-min の brotli 展開や puppeteer-core の chrome devtools
  // 周り)。serverExternalPackages に指定することで、Server Components / Route
  // Handler では node_modules から実体をそのまま読み込む形になり、本番でも安定する。
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;
