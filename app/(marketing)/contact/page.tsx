import { redirect } from "next/navigation";

/**
 * /contact → /support に リダイレクト
 *
 * 既存 /support ページが お問い合わせ窓口 を 兼ねている ため、
 * launch-checklist で 要望が あった /contact URL も 同じ ページ に 誘導 する。
 * 将来 専用 ページ を 切り出す 場合は ここを 通常 ページに 変更 する。
 */
export default function ContactRedirect() {
  redirect("/support");
}
