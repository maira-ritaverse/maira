import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/internal/billing/trial-expire
 *
 * トライアル 終了 後 の 状態 遷移 cron。 30 分 おき に 叩かれる 想定。
 *
 * 処理:
 *   status = 'trialing' かつ trial_ends_at < now の レコード を 対象に、
 *   trial_upgrade_choice の 内容 に 応じて 移行:
 *     - NULL (未選択) → tier='standard' のまま active 化
 *     - 'standard_rec' / 'standard_pro' / 'standard_premium' → 選択した tier に 移行 + active 化
 *
 * Stripe 契約 後 は ここで Stripe Subscription を 作成 / 更新 する 処理 を 追加。
 * 現状 (Stripe 契約 前) は tier と status の 更新 のみ。
 */
export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json(
        { error: "CRON_SECRET / INTAKE_CRON_SECRET 未設定" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const now = new Date();

  type PlanRow = {
    organization_id: string;
    tier: string;
    trial_upgrade_choice: string | null;
  };

  // Stripe 契約 済み の 組織 (stripe_subscription_id NOT NULL) は Stripe
  // Webhook が trialing → active 遷移 を 担う た め、 本 cron の 対象 外。
  // ここ で 触る と last_synced_at の 順序 保証 を 破る 上、 CHECK 制約
  // (ai_boost_enabled と tier の 整合) に 違反 して 永久 失敗 する。
  const { data, error } = await admin
    .from("organization_plans")
    .select("organization_id, tier, trial_upgrade_choice")
    .eq("status", "trialing")
    .lt("trial_ends_at", now.toISOString())
    .is("stripe_subscription_id", null)
    .limit(100);

  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as PlanRow[];

  let migrated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    // 顧客が トライアル中 に 選択した アップグレードを そのまま 採用。
    // 未選択 (= null) なら Standard のみ。
    const newTier = row.trial_upgrade_choice ?? "standard";

    // CHECK 制約 org_plans_ai_boost_matches_tier_check:
    //   tier='standard_pro' <=> ai_boost_enabled=true
    // に 従う。 ai_boost_enabled を 明示 しない と default(false) と
    // tier='standard_pro' が 矛盾 して UPDATE が 永久 に 失敗 する。
    const aiBoostEnabled = newTier === "standard_pro";

    const currentPeriodStart = now.toISOString();
    // MVP では 月次 固定で 30 日後を 次の period_end と する
    // (Stripe 契約後 は invoice 駆動 で 動的更新)
    const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateErr } = await admin
      .from("organization_plans")
      .update({
        tier: newTier,
        ai_boost_enabled: aiBoostEnabled,
        status: "active",
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        next_billed_at: currentPeriodEnd,
      })
      .eq("organization_id", row.organization_id)
      .eq("status", "trialing");

    if (updateErr) {
      errors.push(`update_failed: ${row.organization_id} (${updateErr.message})`);
      continue;
    }

    migrated += 1;
  }

  return NextResponse.json({
    ok: true,
    found: rows.length,
    migrated,
    errors: errors.slice(0, 20),
  });
}

export const GET = POST;
