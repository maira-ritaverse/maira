import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/**
 * 設定 の 詳細 ページ で 使う 共通 の 「戻る」 リンク。
 *
 * これ まで /agency/settings/ 配下 で
 *   ・「←」 + テキスト の Link のみ (ai-usage, integrations)
 *   ・Button + <Link> の 「設定 に 戻る」 (password, profile)
 *   ・そもそも 戻る リンク が ない (custom-fields, email-templates, 等)
 * と 実装 が バラバラ だった の で、 統一 する。
 *
 * デザイン: 小さな 見た目 の 「← 個人 設定」 の 単一 リンク (breadcrumb 的)。
 * page-heading の 上 に 置く 前提。
 */
type Props = {
  /** 戻り 先 URL (通常 は "/agency/settings" or "/app/settings")。 */
  href: string;
  /** 表示 する 戻り 先 の 名前。 デフォルト は 「個人設定」。 */
  label?: string;
};

export function SettingsBackLink({ href, label = "個人設定" }: Props) {
  return (
    <div className="mb-2">
      <Link
        href={href}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {label}
      </Link>
    </div>
  );
}
