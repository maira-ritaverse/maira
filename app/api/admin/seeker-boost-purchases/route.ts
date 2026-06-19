import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { requireUser } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/seeker-boost-purchases
 *
 * 求職者 ドキュメント 作成 ブーストチケット (¥2,000 / 3 ヶ月有効) の 購入履歴 を
 * 運営者向けに 一覧する。 Stripe 連携 (Phase 3) が 反映 されると Webhook で
 * seeker_doc_create_boosts に INSERT され、 ここに 表示される。
 *
 * 認可:isMairaAdmin
 * 戻り値:
 *   ・recent(直近 50 件、 購入新着順)
 *   ・stats(当月 / 累計 の 件数 + 概算売上)
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }
  const admin = createServiceClient();

  // 直近 50 件 + ユーザー情報 を 取得
  // (Service Role で 全行 SELECT、 profiles JOIN で 表示名を 引く)
  const { data: boosts, error } = await admin
    .from("seeker_doc_create_boosts")
    .select(
      "id, user_id, effective_from, effective_until, multiplier_delta, stripe_session_id, purchased_at, refunded_at",
    )
    .order("purchased_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }
  const rows = boosts ?? [];

  // ユーザー 表示名 を 一括 引き
  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const profileMap = new Map<string, { displayName: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string | null }>) {
      profileMap.set(p.id, { displayName: p.display_name, email: null });
    }
    // メアド は auth.users から (service role 必須)
    const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of authUsers?.users ?? []) {
      const existing = profileMap.get(u.id) ?? { displayName: null, email: null };
      profileMap.set(u.id, { ...existing, email: u.email ?? null });
    }
  }

  // 統計 (当月 + 累計)
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { count: monthCount } = await admin
    .from("seeker_doc_create_boosts")
    .select("id", { count: "exact", head: true })
    .gte("purchased_at", monthStart.toISOString())
    .is("refunded_at", null);
  const { count: totalCount } = await admin
    .from("seeker_doc_create_boosts")
    .select("id", { count: "exact", head: true })
    .is("refunded_at", null);
  const { count: refundedCount } = await admin
    .from("seeker_doc_create_boosts")
    .select("id", { count: "exact", head: true })
    .not("refunded_at", "is", null);

  // 売上 概算 (¥2,000 / 件 固定。 価格変更 した 場合は ここを 動的にする 必要あり)
  const UNIT_PRICE_JPY = 2000;
  const monthRevenue = (monthCount ?? 0) * UNIT_PRICE_JPY;
  const totalRevenue = (totalCount ?? 0) * UNIT_PRICE_JPY;

  return NextResponse.json({
    recent: rows.map((r) => {
      const profile = profileMap.get(r.user_id as string) ?? {
        displayName: null,
        email: null,
      };
      return {
        id: r.id,
        userId: r.user_id,
        userDisplayName: profile.displayName,
        userEmail: profile.email,
        effectiveFrom: r.effective_from,
        effectiveUntil: r.effective_until,
        multiplierDelta: r.multiplier_delta,
        stripeSessionId: r.stripe_session_id,
        purchasedAt: r.purchased_at,
        refundedAt: r.refunded_at,
      };
    }),
    stats: {
      monthCount: monthCount ?? 0,
      monthRevenue,
      totalCount: totalCount ?? 0,
      totalRevenue,
      refundedCount: refundedCount ?? 0,
    },
  });
}
