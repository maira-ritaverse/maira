import Script from "next/script";

/**
 * LIFF (LINE Front-end Framework) ページ レイアウト
 *
 * - LIFF SDK を CDN から 読み込む (`liff` グローバル を 提供)
 * - 各 LIFF ページ (例: /liff/[orgId]/jobs/[jobId]) で 'use client' 側 で
 *   liff.init({liffId}) → liff.getProfile() を 呼ぶ
 *
 * 認証/通常 アプリレイアウト と は 完全 別 (ヘッダー / サイドバー なし)。
 * LINE アプリ 内 ブラウザ 専用 UI。
 */
export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" strategy="beforeInteractive" />
      <div className="min-h-screen bg-white">{children}</div>
    </>
  );
}
