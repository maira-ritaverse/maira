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
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/api/", "/app/", "/agency/", "/login", "/signup", "/_next/", "/onboarding/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
