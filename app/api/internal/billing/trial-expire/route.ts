import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/internal/billing/trial-expire
 *
 * トライアル 終了 後 の 状態 遷移 cron。 30 分 おき に 叩かれる 想定。
 *
 * 対象: status='trialing' かつ trial_ends_at < now、 stripe_subscription_id が NULL の 組織。
 *
 * 遷移: status を 'canceled' に 落として 読み 取り 専用 モード に する。
 *   ・Stripe 契約 済 (stripe_subscription_id NOT NULL) の 組織 は Stripe Webhook が
 *     trialing → active を 担う た め 本 cron の 対象 外。
 *   ・未 決済 で 期限 切れ を 迎え た 組織 は、 「決済 せず に フル 機能 を 使い 続け ら れる 穴」
 *     を 塞ぐ た め 明示 的 に canceled に して、 layout の ReadOnlyBanner と
 *     requireWritableOrgPlan で 新規 作成 / 編集 / AI 呼び 出し を 遮断 する。
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
  };

  // Stripe 契約 済み の 組織 (stripe_subscription_id NOT NULL) は Stripe
  // Webhook が trialing → active 遷移 を 担う た め、 本 cron の 対象 外。
  // 未 決済 の トライアル 期限 切れ だけ を 拾う。
  const { data, error } = await admin
    .from("organization_plans")
    .select("organization_id")
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
    // Stripe 契約 前 (stripe_subscription_id NULL) の トライアル 期限 切れ は、
    // 「決済 せず に 使い 続け られる 穴」 を 塞ぐ ため canceled に 遷移 させる。
    // (旧 実装 は tier='standard' に 移して active 化 して いた が、
    //  それ だと 未 決済 で フル 機能 使え て しま う ので 廃止)。
    // ai_boost_enabled は tier CHECK 制約 に 合わせ て false に 明示。
    const { error: updateErr } = await admin
      .from("organization_plans")
      .update({
        tier: "standard",
        ai_boost_enabled: false,
        status: "canceled",
        canceled_at: now.toISOString(),
      })
      .eq("organization_id", row.organization_id)
      .eq("status", "trialing")
      .is("stripe_subscription_id", null);

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
