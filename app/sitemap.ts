import type { MetadataRoute } from "next";

/**
 * /sitemap.xml 動的生成
 *
 * Next.js App Router の規約。ファイル名 sitemap.ts でルートに置くと
 * 自動的に /sitemap.xml として配信される(ビルド時生成)。
 *
 * 公開・固定の URL のみ列挙。共有リンク(/share/intake/*, /f/*)は token を
 * sitemap に載せると意図しない検索インデックスにつながるので除外する。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://maira.pro").replace(/\/$/, "");
  const now = new Date();
  const paths: Array<{ path: string; priority: number; freq: "weekly" | "monthly" }> = [
    { path: "/", priority: 1.0, freq: "weekly" },
    { path: "/privacy", priority: 0.5, freq: "monthly" },
    { path: "/terms", priority: 0.5, freq: "monthly" },
    { path: "/login", priority: 0.6, freq: "monthly" },
    { path: "/signup", priority: 0.7, freq: "monthly" },
  ];
  return paths.map((p) => ({
    url: `${siteUrl}${p.path}`,
    lastModified: now,
    changeFrequency: p.freq,
    priority: p.priority,
  }));
}
