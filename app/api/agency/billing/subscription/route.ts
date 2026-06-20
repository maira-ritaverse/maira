import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import {
  computePrice,
  getCurrentOrganizationPlan,
  isInTrial,
  trialDaysRemaining,
} from "@/lib/billing/agency";

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
    .eq("organization_id", guard.organization.id);
  const memberCount = memberCountRaw ?? 1;

  const price = computePrice(plan.tier, memberCount, plan.cycle);

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
