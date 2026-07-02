"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { STRIPE_AI_BOOST_MONTHLY_JPY, STRIPE_YEARLY_MONTHS } from "@/lib/billing/stripe-pricing";

/**
 * Standard ↔ Standard + Pro を 切り 替える トグル (Client)。
 *
 * ・enabled=true → 「無効 化」 ボタン: DELETE /api/agency/billing/boost
 * ・enabled=false → 「有効 化」 ボタン: POST /api/agency/billing/boost
 * ・確認 ダイアログ で 差 額 (proration) が 発生 する 旨 を 明示
 * ・成功 → window.location.reload で 最新 状態 に 更新
 */
type Props = {
  enabled: boolean;
  cycle: "monthly" | "yearly";
};

export function AiBoostToggle({ enabled, cycle }: Props) {
  // ConfirmActionDialog が throw を 拾って ダイアログ 内 で エラー を 表示 する ため、
  // ここ で は 独自 の error state を 持た ない (二重 表示 を 避ける)。
  const enable = async () => {
    const res = await fetch("/api/agency/billing/boost", { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        detail?: string;
        error?: string;
      } | null;
      throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`);
    }
    window.location.reload();
  };

  const disable = async () => {
    const res = await fetch("/api/agency/billing/boost", { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        detail?: string;
        error?: string;
      } | null;
      throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`);
    }
    window.location.reload();
  };

  const priceLabel =
    cycle === "monthly"
      ? `¥${STRIPE_AI_BOOST_MONTHLY_JPY.toLocaleString()} / 月`
      : `¥${(STRIPE_AI_BOOST_MONTHLY_JPY * STRIPE_YEARLY_MONTHS).toLocaleString()} / 年`;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">AI Boost</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            AI 上限 を 月 500 回 から 1,000 回 に 引き 上げ ます。 追加 料金 {priceLabel} (税別)。
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
          }`}
        >
          {enabled ? "有効" : "無効"}
        </span>
      </div>

      <div className="mt-4">
        {enabled ? (
          <ConfirmActionDialog
            trigger={
              <Button variant="outline" className="w-full">
                AI Boost を 無効 化
              </Button>
            }
            title="AI Boost を 無効 化 します"
            description="現 期間 末 まで の 未 使用 分 は 日割り 返金 (proration) されます。 AI 上限 は 500 回 / 月 に 戻ります。"
            confirmLabel="無効 化 する"
            onConfirm={disable}
          />
        ) : (
          <ConfirmActionDialog
            trigger={<Button className="w-full">AI Boost を 有効 化</Button>}
            title="AI Boost を 有効 化 します"
            description={`次回 請求 から ${priceLabel} が 追加 され、 当月 の 残 日 数 分 は 日割り (proration) 請求 されます。 AI 上限 は 即時 1,000 回 / 月 に 拡張 されます。`}
            confirmLabel="有効 化 する"
            onConfirm={enable}
          />
        )}
      </div>
    </Card>
  );
}
