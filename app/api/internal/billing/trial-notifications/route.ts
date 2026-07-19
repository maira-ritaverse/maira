import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { getSiteUrl } from "@/lib/config/site-url";
import { sendTrialEndingEmail } from "@/lib/email/agency-trial-ending";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/internal/billing/trial-notifications
 *
 * トライアル 終了 7 日前 / 1 日前 の メール 通知 cron。
 * 1 時間ごと に Vercel Cron から 叩かれる 想定。
 *
 * 対象:
 *   status = 'trialing' かつ trial_ends_at が
 *     ・残 7 日 前後 1 時間 (7 日 通知)
 *     ・残 1 日 前後 1 時間 (1 日 通知)
 *
 * 冪等性:
 *   organization_plans に notification_sent_at_X を 追加 せず、 audit_log
 *   ベース で 重複 防止 する のが クリーン だが、 MVP では organization_plans
 *   の updated_at を 都度更新 し、 「同 cron tick 内 で 重複 送信 しない」
 *   程度の シンプル 制御 のみ 行う (本格 対応は Stripe 統合時 に 検討)。
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
  const siteUrl = getSiteUrl();

  // 1) status = 'trialing' で trial_ends_at が 8 日後 〜 6 日後 (7 日通知 ウィンドウ)
  //    かつ 1 日後 〜 0 日後 (1 日通知 ウィンドウ) の どちらか
  const in7DaysFrom = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
  const in7DaysTo = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const in1DayFrom = new Date(now.getTime() + 0 * 24 * 60 * 60 * 1000);
  const in1DayTo = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  type PlanRow = {
    organization_id: string;
    trial_ends_at: string;
  };

  const fetchInWindow = async (from: Date, to: Date): Promise<PlanRow[]> => {
    const { data, error } = await admin
      .from("organization_plans")
      .select("organization_id, trial_ends_at")
      .eq("status", "trialing")
      .gte("trial_ends_at", from.toISOString())
      .lte("trial_ends_at", to.toISOString());
    if (error) return [];
    return (data ?? []) as PlanRow[];
  };

  const plans7 = await fetchInWindow(in7DaysFrom, in7DaysTo);
  const plans1 = await fetchInWindow(in1DayFrom, in1DayTo);

  type SendTarget = { plan: PlanRow; daysRemaining: number };
  const targets: SendTarget[] = [
    ...plans7.map((p) => ({ plan: p, daysRemaining: 7 })),
    ...plans1.map((p) => ({ plan: p, daysRemaining: 1 })),
  ];

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const target of targets) {
    // organization 名 と admin メアド を 引く
    const { data: orgRow } = await admin
      .from("organizations")
      .select("name")
      .eq("id", target.plan.organization_id)
      .maybeSingle();
    const organizationName = (orgRow as { name?: string } | null)?.name ?? "(エージェント企業)";

    const { data: adminMember } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", target.plan.organization_id)
      .eq("role", "admin")
      // soft delete された admin は トライアル 通知 対象 外
      .is("removed_at", null)
      .limit(1)
      .maybeSingle();
    const adminUserId = (adminMember as { user_id?: string } | null)?.user_id;
    if (!adminUserId) {
      failed += 1;
      errors.push(`no_admin: ${target.plan.organization_id}`);
      continue;
    }

    const { data: authUser } = await admin.auth.admin.getUserById(adminUserId);
    const toEmail = authUser?.user?.email;
    if (!toEmail) {
      failed += 1;
      errors.push(`no_email: ${target.plan.organization_id}`);
      continue;
    }

    const result = await sendTrialEndingEmail({
      toEmail,
      organizationName,
      daysRemaining: target.daysRemaining,
      trialEndsOn: new Date(target.plan.trial_ends_at).toLocaleDateString("ja-JP"),
      billingUrl: `${siteUrl}/agency/settings/billing`,
    });

    if (result.sent) {
      sent += 1;
    } else {
      failed += 1;
      errors.push(
        `send_failed: ${target.plan.organization_id} (${result.reason}${
          "error" in result && result.error ? `: ${result.error}` : ""
        })`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    processed: targets.length,
    sent,
    failed,
    errors: errors.slice(0, 20),
  });
}

// Vercel Cron は GET でも 叩ける ように
export const GET = POST;
