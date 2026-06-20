import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { requireUser } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/billing-overview
 *
 * /admin/payments で 使う 集約 API。 3 セクション 用の データを 1 リクエストで 返す:
 *   ・proPlans:エージェント企業 Pro / Premium / 録音 プラン 契約一覧
 *   ・addons:サブスクリプション アドオン (meeting_recording_auto 等)
 *   ・refundsAndExpiries:返金 / 失効 履歴 (ブースト返金 + addon canceled)
 *
 * organization_plans テーブル (docs/agency-billing-design.md 仕様) を 直接 読む。
 * Stripe 連携 前 は trial / 手動切替 の 行 だけ 並ぶ。
 */
type OrganizationPlanRow = {
  organization_id: string;
  tier: "standard" | "standard_rec" | "standard_pro" | "standard_premium";
  cycle: "monthly" | "yearly";
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  trial_ends_at: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

type AddonRow = {
  id: string;
  user_id: string;
  addon_key: string;
  status: "active" | "past_due" | "canceled";
  stripe_subscription_item_id: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
};

type RefundedBoostRow = {
  id: string;
  user_id: string;
  effective_from: string;
  effective_until: string;
  stripe_session_id: string | null;
  purchased_at: string;
  refunded_at: string;
};

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }
  const admin = createServiceClient();

  // ─────────────────────────────────────────
  // 1. アドオン (meeting_recording_auto 等)
  // ─────────────────────────────────────────
  const { data: addonsData } = await admin
    .from("subscription_addons")
    .select(
      "id, user_id, addon_key, status, stripe_subscription_item_id, current_period_end, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  const addons = (addonsData ?? []) as AddonRow[];

  // 統計 (アドオン)
  const activeAddons = addons.filter((a) => a.status === "active").length;
  const pastDueAddons = addons.filter((a) => a.status === "past_due").length;
  const canceledAddons = addons.filter((a) => a.status === "canceled").length;

  // ─────────────────────────────────────────
  // 2. 返金 / 失効 履歴 (ブースト返金 + addon canceled)
  // ─────────────────────────────────────────
  const { data: refundedBoostsData } = await admin
    .from("seeker_doc_create_boosts")
    .select(
      "id, user_id, effective_from, effective_until, stripe_session_id, purchased_at, refunded_at",
    )
    .not("refunded_at", "is", null)
    .order("refunded_at", { ascending: false })
    .limit(50);
  const refundedBoosts = (refundedBoostsData ?? []) as RefundedBoostRow[];

  // ユーザー 表示名 / メアド を 一括 引き
  const userIds = [
    ...new Set([...addons.map((a) => a.user_id), ...refundedBoosts.map((r) => r.user_id)]),
  ];
  const profileMap = new Map<string, { displayName: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string | null }>) {
      profileMap.set(p.id, { displayName: p.display_name, email: null });
    }
    const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of authUsers?.users ?? []) {
      const existing = profileMap.get(u.id) ?? { displayName: null, email: null };
      profileMap.set(u.id, { ...existing, email: u.email ?? null });
    }
  }

  const enrichUser = (userId: string) => {
    const p = profileMap.get(userId) ?? { displayName: null, email: null };
    return { displayName: p.displayName, email: p.email };
  };

  // ─────────────────────────────────────────
  // 3. エージェント企業 プラン 契約一覧
  // ─────────────────────────────────────────
  const { data: plansData } = await admin
    .from("organization_plans")
    .select(
      "organization_id, tier, cycle, status, trial_ends_at, current_period_end, canceled_at, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  const plans = (plansData ?? []) as OrganizationPlanRow[];

  // organization 名 引き
  const orgIds = plans.map((p) => p.organization_id);
  const orgNameMap = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgRows } = await admin.from("organizations").select("id, name").in("id", orgIds);
    for (const o of (orgRows ?? []) as Array<{ id: string; name: string }>) {
      orgNameMap.set(o.id, o.name);
    }
  }

  // 統計 (プラン)
  const planStats = {
    trialing: plans.filter((p) => p.status === "trialing").length,
    active: plans.filter((p) => p.status === "active").length,
    pastDue: plans.filter((p) => p.status === "past_due").length,
    canceled: plans.filter((p) => p.status === "canceled").length,
    // tier 別 (active のみ で 集計、 課金売上 換算 の 元データ)
    byTier: {
      standard: plans.filter((p) => p.tier === "standard" && p.status === "active").length,
      standard_rec: plans.filter((p) => p.tier === "standard_rec" && p.status === "active").length,
      standard_pro: plans.filter((p) => p.tier === "standard_pro" && p.status === "active").length,
      standard_premium: plans.filter((p) => p.tier === "standard_premium" && p.status === "active")
        .length,
    },
  };

  return NextResponse.json({
    proPlans: {
      implemented: true,
      contracts: plans.map((p) => ({
        organizationId: p.organization_id,
        organizationName: orgNameMap.get(p.organization_id) ?? null,
        tier: p.tier,
        cycle: p.cycle,
        status: p.status,
        trialEndsAt: p.trial_ends_at,
        currentPeriodEnd: p.current_period_end,
        canceledAt: p.canceled_at,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
      stats: planStats,
    },
    addons: {
      recent: addons.map((a) => ({
        id: a.id,
        userId: a.user_id,
        ...enrichUser(a.user_id),
        addonKey: a.addon_key,
        status: a.status,
        stripeSubscriptionItemId: a.stripe_subscription_item_id,
        currentPeriodEnd: a.current_period_end,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      })),
      stats: {
        active: activeAddons,
        pastDue: pastDueAddons,
        canceled: canceledAddons,
      },
    },
    refundsAndExpiries: {
      refundedBoosts: refundedBoosts.map((r) => ({
        id: r.id,
        userId: r.user_id,
        ...enrichUser(r.user_id),
        effectiveFrom: r.effective_from,
        effectiveUntil: r.effective_until,
        stripeSessionId: r.stripe_session_id,
        purchasedAt: r.purchased_at,
        refundedAt: r.refunded_at,
      })),
      canceledAddons: addons
        .filter((a) => a.status === "canceled")
        .slice(0, 50)
        .map((a) => ({
          id: a.id,
          userId: a.user_id,
          ...enrichUser(a.user_id),
          addonKey: a.addon_key,
          stripeSubscriptionItemId: a.stripe_subscription_item_id,
          currentPeriodEnd: a.current_period_end,
          updatedAt: a.updated_at,
        })),
      stats: {
        refundedBoostCount: refundedBoosts.length,
        canceledAddonCount: canceledAddons,
      },
    },
  });
}
