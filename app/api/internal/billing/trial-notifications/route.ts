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
 * 冪等性(M8 修正):
 *   organization_plans.trial_notified_7d_at / trial_notified_1d_at を
 *   しきい値ごとのマーカーに使う。未通知(NULL)の組織だけを対象にし、送信成功後に
 *   マーカーを立てることで「1 しきい値 = 1 通」に収める(毎時 cron でも重複しない)。
 *   マーカーは送信後に立てるため at-least-once(稀に再送)。トライアル延長で
 *   trial_ends_at が動いた場合は旧マーカーが残り再通知されない稀な edge がある。
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

  type MarkerCol = "trial_notified_7d_at" | "trial_notified_1d_at";

  // 未通知(markerCol IS NULL)の組織だけを対象にする(冪等: 同一しきい値で 1 回だけ)。
  const fetchInWindow = async (from: Date, to: Date, markerCol: MarkerCol): Promise<PlanRow[]> => {
    const { data, error } = await admin
      .from("organization_plans")
      .select("organization_id, trial_ends_at")
      .eq("status", "trialing")
      .is(markerCol, null)
      .gte("trial_ends_at", from.toISOString())
      .lte("trial_ends_at", to.toISOString());
    if (error) return [];
    return (data ?? []) as PlanRow[];
  };

  const plans7 = await fetchInWindow(in7DaysFrom, in7DaysTo, "trial_notified_7d_at");
  const plans1 = await fetchInWindow(in1DayFrom, in1DayTo, "trial_notified_1d_at");

  type SendTarget = { plan: PlanRow; daysRemaining: number; markerCol: MarkerCol };
  const targets: SendTarget[] = [
    ...plans7.map((p) => ({
      plan: p,
      daysRemaining: 7,
      markerCol: "trial_notified_7d_at" as const,
    })),
    ...plans1.map((p) => ({
      plan: p,
      daysRemaining: 1,
      markerCol: "trial_notified_1d_at" as const,
    })),
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
      // JST で整形しないと Vercel の UTC ランタイムで日付が 1 日ずれる
      // (例: trial_ends_at=…T15:00:00Z = JST 翌日 0:00 → UTC だと前日表示になる)。
      trialEndsOn: new Date(target.plan.trial_ends_at).toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
      }),
      billingUrl: `${siteUrl}/agency/settings/billing`,
    });

    if (result.sent) {
      sent += 1;
      // 送信成功後に冪等マーカーを立てる(同一しきい値の重複送信を防ぐ)。
      // 送信後に立てるので、稀にマーカー更新失敗→次tickで再送(at-least-once)。
      // 未通知のまま48通送るより遥かに良い。失敗はログのみ。
      const { error: markErr } = await admin
        .from("organization_plans")
        .update({ [target.markerCol]: now.toISOString() })
        .eq("organization_id", target.plan.organization_id)
        .eq("status", "trialing");
      if (markErr) {
        console.warn("[trial-notifications] mark failed", {
          organizationId: target.plan.organization_id,
          markerCol: target.markerCol,
          message: markErr.message,
        });
      }
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
