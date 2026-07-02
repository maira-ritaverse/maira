import { Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

/**
 * 課金 免除 (is_billing_exempt = true) の 組織 に 表示 する 情報 カード。
 *
 * ・Checkout / Portal / Boost / Cancel/Reactivate は 全 API が 409 で 拒否 する
 * ・免除 理由 と 適用 日時 を 透明 に 表示 する (信頼 の た め)
 * ・解除 依頼 の 連絡 先 を 明示
 */
export function BillingExemptCard({
  reason,
  setAt,
}: {
  reason: string | null;
  setAt: string | null;
}) {
  return (
    <Card className="border-emerald-200 bg-emerald-50 p-6">
      <div className="flex items-start gap-3">
        <Info className="mt-1 h-5 w-5 text-emerald-700" aria-hidden />
        <div className="flex-1">
          <h2 className="text-base font-semibold text-emerald-900">課金 免除 中</h2>
          <p className="mt-1 text-sm text-emerald-800">
            貴社 は 運営 判断 により、 現在 すべて の 課金 が 停止 されて います。 プラン 加入 /
            変更 / Billing Portal の いずれ も ご 利用 いただけ ません。
          </p>
          <dl className="mt-4 space-y-2 text-xs text-emerald-900">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold">免除 理由</dt>
              <dd>{reason ?? "(記載 なし)"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold">適用 日 時</dt>
              <dd>{setAt ? new Date(setAt).toLocaleString("ja-JP") : "(不明)"}</dd>
            </div>
          </dl>
          <Alert className="mt-4 border-emerald-300 bg-white">
            <AlertDescription className="text-xs text-slate-700">
              解除 の ご 依頼 は maira-info@revorise.jp まで ご 連絡 ください。
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </Card>
  );
}
