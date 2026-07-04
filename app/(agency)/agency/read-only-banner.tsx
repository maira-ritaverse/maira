import Link from "next/link";
import { AlertCircle } from "lucide-react";

/**
 * 読み 取り 専用 モード の 告知 バナー (Server Component)。
 *
 * ・トライアル 期限 切れ で 未 決済、 契約 canceled、 決済 失敗 中 等 に 表示
 * ・agency layout の 全 ページ 上部 に 固定 表示
 * ・「/agency/settings/billing」 に 誘導
 *
 * サーバー 側 の 書き 込み API は 別 途 requireWritableOrgPlan で 遮断 する 前提。
 * この バナー は 「なぜ 操作 でき ない のか」 を 常時 表示 する UI 補助。
 */
type Props = {
  status: "canceled" | "past_due" | "incomplete" | "trial_expired";
};

const CONFIG: Record<
  Props["status"],
  { title: string; body: string; className: string; iconClass: string }
> = {
  trial_expired: {
    title: "無料期間が終了しました",
    body: "現在は読み取り専用モードです。新規作成・編集・AI利用を再開するにはご契約が必要です。",
    className: "border-amber-300 bg-amber-50 text-amber-900",
    iconClass: "text-amber-700",
  },
  canceled: {
    title: "契約が終了しています",
    body: "現在は読み取り専用モードです。新規作成・編集・AI利用を再開するには再契約してください。",
    className: "border-slate-300 bg-slate-50 text-slate-800",
    iconClass: "text-slate-600",
  },
  past_due: {
    title: "お支払いに失敗しています",
    body: "カード情報を更新するまで読み取り専用モードで動作します。Billing Portalから決済情報をご確認ください。",
    className: "border-red-300 bg-red-50 text-red-900",
    iconClass: "text-red-700",
  },
  incomplete: {
    title: "初回決済が完了していません",
    body: "Billing Portal でカード情報を再登録して決済を完了してください。",
    className: "border-slate-300 bg-slate-50 text-slate-800",
    iconClass: "text-slate-600",
  },
};

export function ReadOnlyBanner({ status }: Props) {
  const cfg = CONFIG[status];
  return (
    <div className={`flex items-start gap-3 border-b px-4 py-3 text-sm ${cfg.className}`}>
      <AlertCircle className={`mt-0.5 h-5 w-5 shrink-0 ${cfg.iconClass}`} aria-hidden />
      <div className="flex-1">
        <div className="font-semibold">{cfg.title}</div>
        <div className="mt-0.5 text-xs">{cfg.body}</div>
      </div>
      <Link
        href="/agency/settings/billing"
        className="rounded-md border border-current px-3 py-1 text-xs font-semibold hover:bg-white"
      >
        契約管理へ
      </Link>
    </div>
  );
}
