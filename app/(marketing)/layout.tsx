import type { Metadata } from "next";
import { Fraunces, Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";

/**
 * LP(マーケティング)専用のフォント・トークンを供給するレイアウト。
 *
 * - 既存アプリの Geist(業務UI向け)とは世界観を分けたいので、
 *   このレイアウト配下でだけ和欧三書体を読み込む。
 * - CJK フォントは重いので preload は false。表示は font-display: swap。
 * - 配色トークン(--lp-*)はここで一括宣言し、子コンポーネントから参照する。
 *   アプリ本体の --primary 等とは独立しており、LP の世界観を壊さない。
 */

// 英字の表示・ロゴ用。透明感のある可変セリフ。
const fraunces = Fraunces({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-lp-display",
  display: "swap",
});

// 和文見出し用。編集的な品格を出す明朝系。
const notoSerifJp = Noto_Serif_JP({
  weight: ["400", "600"],
  subsets: ["latin"],
  variable: "--font-lp-ja-display",
  display: "swap",
  preload: false,
});

// 和文本文用。読みやすさ優先のサンセリフ。
const notoSansJp = Noto_Sans_JP({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-lp-ja-body",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Maira - 候補者とつながる、AIネイティブな採用CRM",
  description:
    "中小転職エージェントのための採用管理。AIが対応履歴を要約し、候補者の動きをリアルタイムで届ける。候補者本人がデータを持つから、安心して預けられる。",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${fraunces.variable} ${notoSerifJp.variable} ${notoSansJp.variable} lp-root`}
      style={
        {
          // 落ち着いた知性 / 藍基調。AI 用アクセントは藤色(fujiiro)。
          // 真っ白を避け、ごく僅かに温度のあるオフホワイトを基調に。
          "--lp-bg": "oklch(0.985 0.005 90)",
          "--lp-bg-tint": "oklch(0.972 0.008 95)",
          "--lp-ink": "oklch(0.175 0.038 265)",
          "--lp-ink-soft": "oklch(0.36 0.028 262)",
          "--lp-ink-faint": "oklch(0.55 0.02 258)",
          "--lp-navy": "oklch(0.205 0.045 265)",
          "--lp-navy-deep": "oklch(0.14 0.045 265)",
          "--lp-fuji": "oklch(0.55 0.13 290)",
          "--lp-fuji-soft": "oklch(0.7 0.07 290)",
          "--lp-line": "oklch(0.88 0.012 260)",
          "--lp-line-strong": "oklch(0.74 0.018 260)",
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
