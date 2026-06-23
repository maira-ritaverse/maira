import Image from "next/image";
import Link from "next/link";

import { BrandMark } from "./brand-mark";

/**
 * マーケティング系ページ共通の Footer。
 *
 * 内部アンカー (#features / #cta) は LP に飛ぶ前提なので、
 * /roi 等の別ページ から クリック された場合 は `/#features` / `/#cta` で
 * LP に 遷移 + スクロール する 設計。
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-50 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Image src="/icon-192.png" alt="" width={28} height={28} className="size-7" />
            <BrandMark className="text-base font-bold" />
          </div>
          <p className="text-xs leading-relaxed text-slate-600">
            転職エージェント業務効率化SaaS
            <br />
            運営: 株式会社Revorise
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            プロダクト
          </h3>
          <ul className="space-y-1.5">
            <li>
              <Link href="/#features" className="text-slate-600 hover:text-slate-900">
                機能
              </Link>
            </li>
            <li>
              <Link href="/roi" className="text-slate-600 hover:text-slate-900">
                導入効果を試算
              </Link>
            </li>
            <li>
              <Link href="/#cta" className="text-slate-600 hover:text-slate-900">
                資料請求
              </Link>
            </li>
            <li>
              <Link
                href="/login"
                className="text-slate-600 transition-colors hover:text-orange-500"
              >
                ログイン
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            サポート
          </h3>
          <ul className="space-y-1.5">
            <li>
              <Link href="/contact" className="text-slate-600 hover:text-slate-900">
                お問い合わせ
              </Link>
            </li>
            <li>
              <Link href="/support" className="text-slate-600 hover:text-slate-900">
                ヘルプ
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">法務</h3>
          <ul className="space-y-1.5">
            <li>
              <Link href="/privacy" className="text-slate-600 hover:text-slate-900">
                プライバシーポリシー
              </Link>
            </li>
            <li>
              <Link href="/terms" className="text-slate-600 hover:text-slate-900">
                利用規約
              </Link>
            </li>
            <li>
              <Link href="/legal" className="text-slate-600 hover:text-slate-900">
                特定商取引法
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-6xl border-t border-slate-200 px-5 pt-6 text-center text-xs text-slate-500 lg:px-8">
        &copy; {year} Maira. All rights reserved.
      </div>
    </footer>
  );
}
