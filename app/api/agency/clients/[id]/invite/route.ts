import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendClientInvitationEmail } from "@/lib/email/client-invitation";
import { getUserRole } from "@/lib/organizations/queries";
import {
  defaultInvitationExpiresAt,
  generateInvitationToken,
} from "@/lib/organizations/invitations";

/**
 * エージェント側:クライアント連携の招待発行 / 取消
 *
 * - POST   /api/agency/clients/[id]/invite  → issue_client_invitation
 *   (unlinked|revoked → invited、または invited から再送 = ResendInvitationButton)
 * - DELETE /api/agency/clients/[id]/invite  → cancel_client_invitation
 *   (invited → unlinked、pending な client_invitations も revoke)
 *
 * 認可・遷移検証は SECURITY DEFINER RPC 側で完結する。
 * 本ハンドラの責務:
 *   ・認証 + organization_member ガード
 *   ・トークン生成(crypto.randomBytes)
 *   ・RPC 呼び出し
 *   ・成功時のみ Resend でメール送信
 *   ・RPC エラー → HTTP ステータス マッピング
 */

type RouteParams = { params: Promise<{ id: string }> };

function mapRpcError(message: string): { status: number; code: string; message: string } {
  if (message.includes("unauthenticated")) {
    return { status: 401, code: "unauthenticated", message: "ログインしてください" };
  }
  if (message.includes("forbidden")) {
    return { status: 403, code: "forbidden", message: "この操作の権限がありません" };
  }
  if (message.includes("not_found")) {
    return { status: 404, code: "not_found", message: "クライアントが見つかりません" };
  }
  if (message.includes("resend_too_soon")) {
    return {
      status: 429,
      code: "resend_too_soon",
      message: "前回の送信から 5 分以内は再送できません。少し待ってからお試しください。",
    };
  }
  if (message.includes("invalid_state")) {
    return {
      status: 409,
      code: "invalid_state",
      message: "現在の連携状態ではこの操作はできません",
    };
  }
  return { status: 500, code: "unknown", message: "操作に失敗しました" };
}

async function ensureAgencyMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, supabase, user, role };
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const guard = await ensureAgencyMember();
  if (!guard.ok) return guard.response;

  // 1. トークン + 期限を発行(7 日)
  const token = generateInvitationToken();
  const expiresAt = defaultInvitationExpiresAt();

  // 2. RPC で 招待行 insert + client_records.link_status='invited' + 古い pending を revoke
  const { data: invitationId, error } = await guard.supabase.rpc("issue_client_invitation", {
    p_client_record_id: id,
    p_token: token,
    p_expires_at: expiresAt.toISOString(),
  });

  if (error) {
    const mapped = mapRpcError(error.message ?? "");
    return NextResponse.json(
      { error: mapped.code, message: mapped.message },
      { status: mapped.status },
    );
  }

  // 3. メール送信:client_records から email / name と 担当アドバイザー名 を取り出す
  //    service_role で読む(認可は RPC で済んでいる)。
  const service = createServiceClient();
  const { data: clientRow } = await service
    .from("client_records")
    .select("name, email, assigned_member_id")
    .eq("id", id)
    .maybeSingle();

  if (!clientRow) {
    // RPC が通って client_record が見つからないのは想定外。invitation_id は発行済み。
    return NextResponse.json(
      { success: true, invitationId, emailStatus: { sent: false, reason: "client_not_found" } },
      { status: 201 },
    );
  }

  // 担当アドバイザー名(任意)
  let advisorName: string | null = null;
  if (clientRow.assigned_member_id) {
    const { data: memberRow } = await service
      .from("organization_members")
      .select("user_id")
      .eq("id", clientRow.assigned_member_id)
      .maybeSingle();
    if (memberRow?.user_id) {
      const { data: profile } = await service
        .from("profiles")
        .select("display_name")
        .eq("id", memberRow.user_id)
        .maybeSingle();
      advisorName = (profile?.display_name as string | undefined) ?? null;
    }
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin.replace(/\/+$/, "");
  const inviteUrl = `${siteUrl.replace(/\/+$/, "")}/signup?clientInvitationToken=${encodeURIComponent(token)}`;

  const organizationName = guard.role.organization!.name;

  // email が 未 入力 (LINE 由来 で AI 抽出 でき なかった 等) の 場合 は 招待 でき ない。
  const clientEmail = (clientRow as { email: string | null }).email;
  if (!clientEmail || !clientEmail.trim()) {
    return NextResponse.json(
      {
        error: "no_email",
        message:
          "顧客 の メール アドレス が 未 登録 で 招待 メール を 送れ ません。 詳細 画面 で 補完 して ください。",
      },
      { status: 400 },
    );
  }
  const emailResult = await sendClientInvitationEmail({
    toEmail: clientEmail,
    seekerName: (clientRow.name as string) ?? "",
    organizationName,
    advisorName,
    inviteUrl,
    expiresAt,
  });

  return NextResponse.json(
    {
      success: true,
      invitationId,
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
      emailStatus: emailResult.sent ? { sent: true } : { sent: false, reason: emailResult.reason },
    },
    { status: 201 },
  );
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const guard = await ensureAgencyMember();
  if (!guard.ok) return guard.response;

  const { error } = await guard.supabase.rpc("cancel_client_invitation", {
    p_client_record_id: id,
  });

  if (error) {
    const mapped = mapRpcError(error.message ?? "");
    return NextResponse.json(
      { error: mapped.code, message: mapped.message },
      { status: mapped.status },
    );
  }

  return NextResponse.json({ success: true });
}
