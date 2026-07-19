import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import {
  buildInvitationUrl,
  defaultInvitationExpiresAt,
  generateInvitationToken,
} from "@/lib/organizations/invitations";
import { sendInvitationEmail } from "@/lib/email/invitation";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getSeatCapStatus } from "@/lib/billing/seat-cap";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";

/**
 * POST /api/agency/invitations
 *
 * 招待を発行する(admin のみ)。
 *
 * 流れ:
 *   1. 認証 + admin チェック(RPC 側でも再検証する二重防御)
 *   2. crypto.randomBytes 由来のトークン生成(base64url、暗号学的に安全)
 *   3. issue_invitation RPC で「既存メンバー判定 → 旧 pending を revoke →
 *      新規 insert → 監査ログ」を同一トランザクションで実行
 *   4. 招待リンクを組み立て、Resend が設定済みならメール送信
 *      (未設定なら送信スキップ → 結果に inviteUrl と emailStatus を返す)
 *
 * S5(承認・参加処理)はまだ無いため、リンクは飛んでも参加できない。
 * UI 側に inviteUrl を表示してコピー手段を提供する。
 */

const bodySchema = z.object({
  email: z.string().email("メールアドレスの形式が正しくありません"),
  role: z.enum(["admin", "advisor"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // ── 席数上限 チェック (Solo プラン等 で 席数 超過 の 招待 を 事前 に 弾く)
  //    ・現役 メンバー + 保留中 招待 の 合算 が 上限 に 達して いれば 402
  //    ・プラン 未開始 の 組織 は フォールバック として standard 相当 で 3 席 まで
  //    ・issue_invitation RPC 側 の 二重防御 は Phase 5 の 別 コミット で 追加
  const plan = await getCurrentOrganizationPlan(supabase);
  const tier = plan?.tier ?? "standard";
  const seatStatus = await getSeatCapStatus(supabase, role.organization.id, tier);
  if (seatStatus.reached) {
    const entitlements = getPlanEntitlements(tier);
    const canInvite = entitlements.canInviteMembers;
    return NextResponse.json(
      {
        error: "seat_cap_reached",
        message: canInvite
          ? `席数の上限 (${seatStatus.cap} 席) に達しています。プランをアップグレードするか、既存メンバーを整理してください。`
          : "このプランでは追加のメンバー招待に対応していません。プランをアップグレードしてください。",
        current: seatStatus.current,
        cap: seatStatus.cap,
        tier: seatStatus.tier,
      },
      { status: 402 },
    );
  }

  const token = generateInvitationToken();
  const expiresAt = defaultInvitationExpiresAt();

  const { data: newId, error } = await supabase.rpc("issue_invitation", {
    invitation_email: parsed.data.email,
    invitation_role: parsed.data.role,
    invitation_token: token,
    invitation_expires_at: expiresAt.toISOString(),
  });

  if (error) {
    const message = error.message ?? "";

    if (message.includes("already_member")) {
      return NextResponse.json(
        {
          error: "already_member",
          message: "このメールアドレスは既にこの組織のメンバーです。",
        },
        { status: 400 },
      );
    }
    if (message.includes("forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message.includes("invalid_email") || message.includes("invalid_role")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    return NextResponse.json({ error: "Failed to issue invitation", message }, { status: 500 });
  }

  // 招待リンクは NEXT_PUBLIC_SITE_URL を基準に組み立てる。
  // 未設定の場合はリクエスト origin で代替(本番環境はちゃんと環境変数を設定する想定)。
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const inviteUrl = buildInvitationUrl(token, siteUrl);

  const emailResult = await sendInvitationEmail({
    toEmail: parsed.data.email,
    organizationName: role.organization.name,
    inviteUrl,
    token,
    siteUrl,
    expiresAt,
  });

  return NextResponse.json({
    success: true,
    invitationId: newId as string,
    inviteUrl,
    expiresAt: expiresAt.toISOString(),
    emailStatus: emailResult.sent ? { sent: true } : { sent: false, reason: emailResult.reason },
  });
}
