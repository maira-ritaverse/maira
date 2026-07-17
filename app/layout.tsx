import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { getSiteUrl } from "@/lib/config/site-url";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Maira - AI 採用エージェント",
    template: "%s | Maira",
  },
  description:
    "20-30 代の転職活動者向けの AI 採用エージェント。キャリア棚卸し、診断、書類作成、応募管理、AI 求人推薦、面接練習までを一括で。録音 → 履歴書自動生成、Zoom / Google Meet 連携にも対応。",
  applicationName: "Maira",
  authors: [{ name: "株式会社Revorise", url: siteUrl }],
  creator: "株式会社Revorise",
  publisher: "株式会社Revorise",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Maira",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: siteUrl,
    siteName: "Maira",
    title: "Maira - AI 採用エージェント",
    description: "キャリア棚卸し、診断、書類作成、応募管理、AI 求人推薦、面接練習までを一括で。",
  },
  twitter: {
    card: "summary_large_image",
    title: "Maira - AI 採用エージェント",
    description: "キャリア棚卸し、診断、書類作成、応募管理、AI 求人推薦、面接練習までを一括で。",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        {/* Vercel Web Analytics:本番のみ 自動収集 (PII なし、Cookieless) */}
        <Analytics />
      </body>
    </html>
  );
}
