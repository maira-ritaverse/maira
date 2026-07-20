import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import {
  SOLO_MONTHLY_PRICE,
  computePrice,
  getCurrentOrganizationPlan,
  isInTrial,
  trialDaysRemaining,
} from "@/lib/billing/agency";
import { STRIPE_CYCLE_MONTHS, STRIPE_YEARLY_MONTHS } from "@/lib/billing/stripe-pricing";

/**
 * GET /api/agency/billing/subscription
 *
 * 自組織の 現プラン情報 を 返す (admin / advisor どちらでも 可)。
 * UI で 料金透明性 を 確保 する ため 全員が 閲覧可能 と している。
 *
 * 価格 内訳 と トライアル 残日数 を 計算済みで 返す ので、
 * クライアント側 は そのまま 表示 する だけ で 良い。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const plan = await getCurrentOrganizationPlan(guard.supabase);
  if (!plan) {
    return NextResponse.json({ plan: null });
  }

  const { count: memberCountRaw } = await guard.supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", guard.organization.id)
    // soft delete された メンバー は 席数 に 含めない
    .is("removed_at", null);
  const memberCount = memberCountRaw ?? 1;

  // Solo 系 は computePrice が throw する ため、 SOLO_MONTHLY_PRICE から 直接 計算
  // した PriceBreakdown を 組み立て る (呼出 側 UI が Team 系 と 同 型 の shape を
  // 期待 する ため、 base / perSeatExtra / upgrade / yearly の フィールド を 埋める)。
  const soloKey: "solo" | "solo_pro" | null =
    plan.tier === "solo" ? "solo" : plan.tier === "solo_pro" ? "solo_pro" : null;
  const price =
    soloKey !== null
      ? (() => {
          const monthly = SOLO_MONTHLY_PRICE[soloKey];
          const yearly = monthly * STRIPE_YEARLY_MONTHS;
          return {
            base: monthly,
            perSeatExtra: 0,
            upgrade: 0,
            monthlyTotal: monthly,
            yearlyTotal: yearly,
            yearlyMonthlyEquivalent: Math.round(yearly / STRIPE_CYCLE_MONTHS),
          };
        })()
      : computePrice(plan.tier, memberCount, plan.cycle);

  return NextResponse.json({
    plan: {
      tier: plan.tier,
      cycle: plan.cycle,
      status: plan.status,
      trialEndsAt: plan.trialEndsAt,
      trialUpgradeChoice: plan.trialUpgradeChoice,
      currentPeriodEnd: plan.currentPeriodEnd,
      canceledAt: plan.canceledAt,
    },
    inTrial: isInTrial(plan),
    trialDaysRemaining: trialDaysRemaining(plan),
    memberCount,
    price,
  });
}
