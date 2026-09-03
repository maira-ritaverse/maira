import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/config/site-url";

/**
 * /robots.txt 動的生成
 *
 * Next.js App Router の規約。ファイル名 robots.ts でルートに置くと
 * 自動的に /robots.txt として配信される(ビルド時生成)。
 *
 * 方針:
 *   - 公開 LP / 規約 / プライバシーポリシー / 共有リンクのみ index 許可
 *   - 認証必須エリア(/app, /agency)+ API + 認証コールバック等は disallow
 *   - 共有リンク(/share/intake/*, /f/*)は意図的に index 許可(B2B 用途)
 *   - fallback は app.maira.pro(Next.js は app サブドメインのみ)
 *   - AI 学習クローラー(GPTBot / ClaudeBot / CCBot / Google-Extended 等)は全面拒否。
 *     Myaira のコンテンツを学習データ化・複製されるのを防ぐ意思表示(順法クローラー向け。
 *     UA 偽装するボットには効かないが、主要クローラーは robots に従う)。通常の検索
 *     エンジン(Googlebot / Bingbot 等)はマーケ集客のため従来どおり許可する。
 */

/**
 * 全面拒否する AI 学習 / スクレイピング系クローラーの User-Agent 一覧。
 * (OpenAI / Anthropic / Google AI / Common Crawl / Perplexity / ByteDance / Apple AI /
 *  Meta AI / Amazon / Cohere など、公表されている主要な AI クローラーを網羅)
 */
const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "Claude-SearchBot",
  "Google-Extended",
  "CCBot",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "Amazonbot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "meta-externalagent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "Omgili",
  "YouBot",
  "Timpibot",
  "PetalBot",
  "DataForSeoBot",
  "AI2Bot",
];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/api/", "/app/", "/agency/", "/login", "/signup", "/_next/", "/onboarding/"],
      },
      // AI 学習 / スクレイピング系クローラーはサイト全体を拒否
      {
        userAgent: AI_CRAWLER_USER_AGENTS,
        disallow: ["/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
