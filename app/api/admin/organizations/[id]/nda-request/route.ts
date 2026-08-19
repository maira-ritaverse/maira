import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { sendNdaSignatureRequestEmail } from "@/lib/email/nda-signature-request";
import { consumeRateLimit } from "@/lib/rate-limit/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/admin/organizations/[id]/nda-request
 *
 * 運営者(Myaira admin)が、対象組織の管理者(role=admin, 非 archived)全員に
 * NDA 署名依頼のリマインドメールを送る。自動ゲートが見えない等のフォールバック用。
 *
 * Auth: profiles.is_maira_admin = true のみ。
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isMairaAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 連打 / 濫用でのメールスパム防止(reveal-notes と同じ多層防御)。
  const rl = await consumeRateLimit({
    namespace: "admin:nda-request",
    identifier: user.id,
    windowSeconds: 60,
    maxCount: 20,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate_limited", message: "送信が多すぎます。しばらくしてからお試しください。" },
      { status: 429 },
    );
  }

  const admin = createServiceClient();

  const { data: orgRow } = await admin
    .from("organizations")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  const organizationName = (orgRow as { name?: string } | null)?.name ?? "(エージェント企業)";

  // 対象組織の管理者(非 archived)の user_id を取得。
  const { data: members } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", id)
    .eq("role", "admin")
    .is("removed_at", null);
  const userIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "no_admin", message: "対象組織に管理者がいません。" },
      {
        status: 400,
      },
    );
  }

  const lookups = await Promise.all(userIds.map((uid) => admin.auth.admin.getUserById(uid)));
  const emails = lookups
    .map((r) => r.data?.user?.email ?? null)
    .filter((e): e is string => typeof e === "string" && e.length > 0);
  if (emails.length === 0) {
    return NextResponse.json(
      { error: "no_admin_email", message: "管理者のメールアドレスが取得できませんでした。" },
      { status: 400 },
    );
  }

  let sent = 0;
  for (const email of emails) {
    const r = await sendNdaSignatureRequestEmail({ toEmail: email, organizationName });
    if (r.sent) sent += 1;
    else console.warn("[admin/nda-request] send failed", { reason: r.reason });
  }

  await recordAuditLog({
    userId: user.id,
    action: "nda_signature_requested",
    metadata: { organizationId: id, sentCount: sent, totalAdmins: emails.length },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  // 1 件も送れなかった場合(EMAIL_FROM 未設定 / 全失敗)は成功扱いにしない。
  if (sent === 0) {
    return NextResponse.json(
      {
        error: "send_failed",
        message: "メールを送信できませんでした(メール設定をご確認ください)。",
        sentCount: 0,
        totalAdmins: emails.length,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, sentCount: sent, totalAdmins: emails.length });
}
