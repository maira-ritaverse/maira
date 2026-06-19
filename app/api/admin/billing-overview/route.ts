import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { requireUser } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/billing-overview
 *
 * /admin/payments で 使う 集約 API。 3 セクション 用の データを 1 リクエストで 返す:
 *   ・proPlans:エージェント企業 Pro プラン 契約一覧 (現状 機能未実装 → 0 件)
 *   ・addons:サブスクリプション アドオン (meeting_recording_auto 等)
 *   ・refundsAndExpiries:返金 / 失効 履歴 (ブースト返金 + addon canceled)
 *
 * Pro プラン は organizations.plan カラム 未設置 のため、 当面 0 件 を 返す。
 * 実装後 (docs/agency-pro-plan-design.md Phase 1) に SELECT を 切替える。
 */
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

  return NextResponse.json({
    proPlans: {
      // Pro プラン 機能 未実装 (docs/agency-pro-plan-design.md Phase 1 着手後 に
      // organizations.plan カラム を 追加 して ここで SELECT する)
      implemented: false,
      contracts: [],
      stats: { active: 0, expired: 0 },
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
