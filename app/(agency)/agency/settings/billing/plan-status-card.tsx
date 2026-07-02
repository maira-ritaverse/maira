import { Card } from "@/components/ui/card";
import {
  computeStripePrice,
  STRIPE_EXTRA_SEAT_MONTHLY_JPY,
  STRIPE_INCLUDED_SEATS,
  type StripeCycle,
  type StripeTier,
} from "@/lib/billing/stripe-pricing";

/**
 * 契約 中 プラン の 現状 を 表示 する 静的 カード (Server Component)。
 *
 * 表示 項目:
 *   ・プラン 名 (Standard / Standard + Pro)
 *   ・ステータス バッジ (trialing / active / past_due / canceled / incomplete)
 *   ・課金 サイクル (月払い / 年払い)
 *   ・席 数 内訳 (Base 3 席 + Extra Seat n 席)
 *   ・トライアル 中 なら 残 日 数 と 終了 日、 それ 以外 は 次回 請求 日
 *   ・料金 内訳 (Base / Extra Seat / AI Boost) と 月 額 合計
 *   ・期末 解約 予約 中 (canceled_at 有 + status trialing/active) は 情報 バッジ
 *
 * 料金 は STRIPE_PRICING の 純関数 で 算出。 Stripe の 実 請求 額 と 一致 する 前提。
 */
type PlanStatusInput = {
  tier: StripeTier | "standard_rec" | "standard_premium";
  cycle: StripeCycle;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  seatCount: number;
  aiBoostEnabled: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
};

export function PlanStatusCard({ plan }: { plan: PlanStatusInput }) {
  // Stripe 契約 で 使う の は standard / standard_pro のみ。 旧 tier (rec / premium)
  // は 保険 で standard 扱い に フォールバック。
  const stripeTier: StripeTier = plan.tier === "standard_pro" ? "standard_pro" : "standard";
  const price = computeStripePrice({
    tier: stripeTier,
    seatCount: plan.seatCount,
    cycle: plan.cycle,
  });
  const extraSeats = Math.max(0, plan.seatCount - STRIPE_INCLUDED_SEATS);
  const isTrial = plan.status === "trialing";
  const daysLeft = plan.trialEndsAt ? daysUntil(plan.trialEndsAt) : 0;
  // 解約 予約 中 は 「status !== canceled かつ canceled_at NOT NULL」 で 一意 に 判定 する。
  // 従来 active / trialing のみ で 見て いた が、 past_due や incomplete 中 に
  // Portal から cancel_at_period_end を 立て られる ケース も あり、 その 時 に
  // ページ 側 の SubscribedActionsCard は pendingCancel=true 判定 に なる の で
  // バッジ と 挙動 の 一致 を 取る。
  const isPendingCancel = plan.status !== "canceled" && plan.canceledAt !== null;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">現 プラン</h2>
        <StatusBadge status={plan.status} pendingCancel={isPendingCancel} />
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <Row label="プラン">{stripeTier === "standard_pro" ? "Standard + Pro" : "Standard"}</Row>
        <Row label="課金 サイクル">
          {plan.cycle === "monthly" ? "月払い" : "年払い (2 ヶ月 分 割引)"}
        </Row>
        <Row label="席 数">
          {plan.seatCount} 席 (Base {STRIPE_INCLUDED_SEATS} 席 + Extra Seat {extraSeats} 席)
        </Row>

        {isTrial && (
          <Row label="無料 期間 残 日 数">
            <span className="font-semibold text-emerald-700">{daysLeft} 日</span>
            {plan.trialEndsAt && (
              <span className="text-muted-foreground ml-2 text-xs">
                ({new Date(plan.trialEndsAt).toLocaleDateString("ja-JP")} 終了)
              </span>
            )}
          </Row>
        )}

        {!isTrial && plan.currentPeriodEnd && !isPendingCancel && (
          <Row label="次回 請求 日">
            {new Date(plan.currentPeriodEnd).toLocaleDateString("ja-JP")}
          </Row>
        )}

        {isPendingCancel && plan.currentPeriodEnd && (
          <Row label="解約 予定 日">
            <span className="font-semibold text-amber-700">
              {new Date(plan.currentPeriodEnd).toLocaleDateString("ja-JP")}
            </span>
            <span className="text-muted-foreground ml-2 text-xs">以降 は 契約 が 終了 します</span>
          </Row>
        )}
      </div>

      <hr className="my-4" />

      <h3 className="text-sm font-semibold">月額 内訳 (税別)</h3>
      <div className="mt-3 space-y-2 text-sm">
        <PriceRow label={`Base (${STRIPE_INCLUDED_SEATS} 席 込み)`}>
          ¥{price.base.toLocaleString()}
        </PriceRow>
        {extraSeats > 0 && (
          <PriceRow
            label={`Extra Seat (¥${STRIPE_EXTRA_SEAT_MONTHLY_JPY.toLocaleString()} × ${extraSeats} 席)`}
          >
            ¥{price.extraSeat.toLocaleString()}
          </PriceRow>
        )}
        {plan.aiBoostEnabled && (
          <PriceRow label="AI Boost (Pro アップグレード)">
            ¥{price.aiBoost.toLocaleString()}
          </PriceRow>
        )}
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-sm font-semibold">
            {plan.cycle === "yearly" ? "月 単価 相当" : "月額 合計"}
          </span>
          <span className="text-base font-bold text-emerald-700">
            ¥
            {(plan.cycle === "yearly"
              ? price.yearlyMonthlyEquivalent
              : price.monthlyTotal
            ).toLocaleString()}
          </span>
        </div>
        {plan.cycle === "yearly" && (
          <p className="text-muted-foreground text-xs">
            年 額 ¥{price.yearlyTotal.toLocaleString()} を 一括 請求 (2 ヶ月 分 割引 適用)
          </p>
        )}
      </div>
    </Card>
  );
}

function daysUntil(iso: string, now: Date = new Date()): number {
  const diff = new Date(iso).getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function PriceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function StatusBadge({
  status,
  pendingCancel,
}: {
  status: PlanStatusInput["status"];
  pendingCancel: boolean;
}) {
  const base: Record<PlanStatusInput["status"], { label: string; cls: string }> = {
    trialing: { label: "無料 期間 中", cls: "bg-emerald-100 text-emerald-800" },
    active: { label: "契約 中", cls: "bg-blue-100 text-blue-800" },
    past_due: { label: "課金 失敗", cls: "bg-amber-100 text-amber-800" },
    canceled: { label: "解約 済", cls: "bg-slate-100 text-slate-700" },
    incomplete: { label: "初期 設定 未 完了", cls: "bg-slate-100 text-slate-700" },
  };
  const m = pendingCancel
    ? { label: "解約 予約 中", cls: "bg-amber-100 text-amber-800" }
    : base[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>
  );
}
