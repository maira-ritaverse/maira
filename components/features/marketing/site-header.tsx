import Image from "next/image";
import Link from "next/link";
import { FileText } from "lucide-react";

import { BrandMark } from "./brand-mark";

/**
 * マーケティング系ページ共通の Header。
 *
 * LP (/) と /roi など、 サイト全体で同じ ナビ を 出したい ページ で使う。
 * /support、 /privacy、 /terms など、 ページ内に専用 <header> を 持つ
 * 既存ページ は あえて 使わない (= 視覚的二重 header を 避ける ため)。
 *
 * 「資料請求」 ボタン は LP の #cta アンカー を 指す。 /roi など 別 ページ
 * から クリック された場合 は LP に 遷移 してから アンカー へ。
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="Maira トップ">
          <Image src="/icon-192.png" alt="" width={32} height={32} priority className="size-8" />
          <BrandMark className="text-lg font-bold tracking-tight" />
          <span className="text-muted-foreground ml-1 text-[10px] tracking-[0.2em] uppercase">
            for agencies
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/login"
            className="hidden text-sm text-slate-600 transition-colors hover:text-orange-500 sm:inline"
          >
            ログイン
          </Link>
          <Link
            href="/#cta"
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <FileText className="size-3.5" aria-hidden />
            資料請求
          </Link>
        </nav>
      </div>
    </header>
  );
}
