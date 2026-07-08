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
  // Batch 1 で client_records.email が nullable に なった 影響 で、 何らか の 理由 で
  // route.ts 側 の 事前 検証 を すり抜けた 場合 に Postgres が NOT NULL 制約 違反 を
  // 返す 可能性 が ある。 「null value in column "email"」 に 特定 する こと で 他 の
  // NOT NULL 違反 (organization_id 等) と 混同 しない。
  if (/null value in column "email"/i.test(message)) {
    return {
      status: 400,
      code: "no_email",
      message:
        "顧客 の メール アドレス が 未 登録 で 招待 メール を 送れ ませ ん。 詳細 画面 で メール アドレス を 補完 して から 再度 お試し ください。",
    };
  }
  // Batch 1 で 追加 した immutable trigger が SECURITY DEFINER RPC 経由 の 正当 な
  // 更新 も ブロック する 症状 (20260708000007 で 修正 済) の 生存 確認 用。
  // 万一 マイグレーション 未 適用 の 環境 で 発生 して も 「操作 に 失敗 しました」
  // で は 意味 が わから ない ため、 明確 な 文言 で 案内 する。
  if (/is immutable via direct update/i.test(message)) {
    return {
      status: 500,
      code: "trigger_immutable",
      message:
        "内部 エラー: 連携 情報 の 更新 が 権限 で ブロック さ れ ました。 マイグレーション 20260708000007 が 未 適用 の 可能性 が あり ます。",
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

  // 1. 招待 に 必要 な 情報 (email / name / 組織 / 担当) を 先 に 取得。
  //
  //    修正 の 動機 (2026-07-08):
  //    Batch 1 で client_records.email を nullable に して LINE 由来 の 顧客
  //    (AI 抽出 で email が 埋まら なかった ケース) を 保存 できる ように した が、
  //    RPC issue_client_invitation は 内部 で `insert into client_invitations
  //    (email, ...) values (client_records.email, ...)` を 行い、 client_invitations.email
  //    は NOT NULL の ため NULL の 顧客 で は Postgres 制約 違反 に なり RPC が
  //    500 を 投げて mapRpcError が 「操作 に 失敗 しました」 に な って いた。
  //    → RPC 呼び 出し 前 に email 有無 を 明示 検証 し、 400 no_email を 返す。
  const service = createServiceClient();
  const { data: clientRow } = await service
    .from("client_records")
    .select("name, email, assigned_member_id, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!clientRow) {
    return NextResponse.json(
      { error: "not_found", message: "クライアント が 見つかり ませ ん" },
      { status: 404 },
    );
  }

  // 二重 防御: 別 組織 の 顧客 UUID を 掴まされ た 場合。 RPC 側 でも 検証 する が
  // 事前 に 404 相当 で 弾く (record enumeration 対策)。
  if (clientRow.organization_id !== guard.role.organization!.id) {
    return NextResponse.json(
      { error: "not_found", message: "クライアント が 見つかり ませ ん" },
      { status: 404 },
    );
  }

  const clientEmail = (clientRow as { email: string | null }).email;
  if (!clientEmail || !clientEmail.trim()) {
    return NextResponse.json(
      {
        error: "no_email",
        message:
          "顧客 の メール アドレス が 未 登録 で 招待 メール を 送れ ませ ん。 詳細 画面 で メール アドレス を 補完 して から 再度 お試し ください。",
      },
      { status: 400 },
    );
  }

  // 2. トークン + 期限 を 発行 (7 日)
  const token = generateInvitationToken();
  const expiresAt = defaultInvitationExpiresAt();

  // 3. RPC で 招待 行 insert + client_records.link_status='invited' + 古い pending を revoke
  const { data: invitationId, error } = await guard.supabase.rpc("issue_client_invitation", {
    p_client_record_id: id,
    p_token: token,
    p_expires_at: expiresAt.toISOString(),
  });

  if (error) {
    const mapped = mapRpcError(error.message ?? "");
    // mapRpcError が unknown に fallback した ケース は 「想定 外 の エラー」 な の で
    // 診断 の ため に 生 メッセージ を server ログ に 残す (client レスポンス に は 出さない)。
    if (mapped.code === "unknown") {
      console.error("[client-invite] issue_client_invitation failed with unmapped error", {
        clientRecordId: id,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
    return NextResponse.json(
      { error: mapped.code, message: mapped.message },
      { status: mapped.status },
    );
  }

  // 4. 担当 アドバイザー 名 (任意)
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
