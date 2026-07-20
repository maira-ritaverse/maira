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
  // Stripe 契約 で 使う の は standard / standard_pro / solo / solo_pro。
  // 旧 tier (rec / premium) は 保険 で standard 扱い に フォールバック。
  const stripeTier: StripeTier =
    plan.tier === "standard_pro"
      ? "standard_pro"
      : plan.tier === "solo"
        ? "solo"
        : plan.tier === "solo_pro"
          ? "solo_pro"
          : "standard";
  const isSolo = stripeTier === "solo" || stripeTier === "solo_pro";
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
        <h2 className="text-base font-semibold">現プラン</h2>
        <StatusBadge status={plan.status} pendingCancel={isPendingCancel} />
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <Row label="プラン">{tierLabel(stripeTier)}</Row>
        <Row label="課金サイクル">
          {plan.cycle === "monthly" ? "月払い" : "年払い(2ヶ月分割引)"}
        </Row>
        {/* Solo 系 は 1 席 固定 な の で 席数 行 は 出さ ない (混乱 の 元) */}
        {!isSolo && (
          <Row label="席数">
            {plan.seatCount}席(Base {STRIPE_INCLUDED_SEATS}席 + Extra Seat {extraSeats}席)
          </Row>
        )}

        {isTrial && (
          <Row label="無料期間残日数">
            <span className="font-semibold text-emerald-700">{daysLeft}日</span>
            {plan.trialEndsAt && (
              <span className="text-muted-foreground ml-2 text-xs">
                ({new Date(plan.trialEndsAt).toLocaleDateString("ja-JP")}終了)
              </span>
            )}
          </Row>
        )}

        {!isTrial && plan.currentPeriodEnd && !isPendingCancel && (
          <Row label="次回請求日">
            {new Date(plan.currentPeriodEnd).toLocaleDateString("ja-JP")}
          </Row>
        )}

        {isPendingCancel && plan.currentPeriodEnd && (
          <Row label="解約予定日">
            <span className="font-semibold text-amber-700">
              {new Date(plan.currentPeriodEnd).toLocaleDateString("ja-JP")}
            </span>
            <span className="text-muted-foreground ml-2 text-xs">以降は契約が終了します</span>
          </Row>
        )}
      </div>

      <hr className="my-4" />

      <h3 className="text-sm font-semibold">月額内訳(税別)</h3>
      <div className="mt-3 space-y-2 text-sm">
        {/* Solo 系 は 単一 Price 決済 な の で Base 行 の ラベル を 「(1 席 込み)」 に する */}
        <PriceRow label={isSolo ? "月額(1席込み)" : `Base(${STRIPE_INCLUDED_SEATS}席込み)`}>
          ¥{price.base.toLocaleString()}
        </PriceRow>
        {!isSolo && extraSeats > 0 && (
          <PriceRow
            label={`Extra Seat(¥${STRIPE_EXTRA_SEAT_MONTHLY_JPY.toLocaleString()} × ${extraSeats}席)`}
          >
            ¥{price.extraSeat.toLocaleString()}
          </PriceRow>
        )}
        {!isSolo && plan.aiBoostEnabled && (
          <PriceRow label="AI Boost(Proアップグレード)">¥{price.aiBoost.toLocaleString()}</PriceRow>
        )}
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-sm font-semibold">
            {plan.cycle === "yearly" ? "月単価相当" : "月額合計"}
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
            年額 ¥{price.yearlyTotal.toLocaleString()} を一括請求(2ヶ月分割引適用)
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

function tierLabel(tier: StripeTier): string {
  switch (tier) {
    case "standard_pro":
      return "Standard + Pro";
    case "solo":
      return "Solo(個人プラン)";
    case "solo_pro":
      return "Solo Pro(個人プラン)";
    case "standard":
    default:
      return "Standard";
  }
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
    trialing: { label: "無料期間中", cls: "bg-emerald-100 text-emerald-800" },
    active: { label: "契約中", cls: "bg-blue-100 text-blue-800" },
    past_due: { label: "課金失敗", cls: "bg-amber-100 text-amber-800" },
    canceled: { label: "解約済", cls: "bg-slate-100 text-slate-700" },
    incomplete: { label: "初期設定未完了", cls: "bg-slate-100 text-slate-700" },
  };
  const m = pendingCancel
    ? { label: "解約予約中", cls: "bg-amber-100 text-amber-800" }
    : base[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>
  );
}
