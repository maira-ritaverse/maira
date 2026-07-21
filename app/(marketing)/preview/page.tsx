import type { Metadata } from "next";

import { LandingPagePreview } from "@/components/features/marketing/landing-page-preview";

/**
 * LP 改作版のプレビュールート。
 *
 * - 本番LP(/)とは別ファイルに切り出し、デザインの比較ができるようにしている。
 *   本番ページを上書きしないため、(marketing)/page.tsx には一切手を入れない。
 * - 認証リダイレクトを行わない:このページはデザインレビュー用なので、
 *   ログイン状態に関わらず常に新版を表示する。誤って /preview をエンドユーザーに
 *   案内しないこと(URLを把握している関係者のみ閲覧する想定)。
 * - サイト全体のクロールに乗らないよう、noindex を付ける。
 */
export const metadata: Metadata = {
  title: "Myaira — Preview Edition (Agencies)",
  description: "Myaira エージェント向け LP の改作プレビュー。比較用。",
  robots: {
    index: false,
    follow: false,
  },
};

export default function PreviewPage() {
  return <LandingPagePreview />;
}
