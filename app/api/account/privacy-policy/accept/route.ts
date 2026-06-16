import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit/audit-log";
import { requireUser } from "@/lib/api/auth-guards";
import { CURRENT_PRIVACY_POLICY_VERSION } from "@/lib/privacy/policy";

/**
 * POST /api/account/privacy-policy/accept
 *
 * 認証ユーザがプライバシーポリシーに同意した記録を残す。
 *
 * - profiles.privacy_policy_accepted_at / privacy_policy_version を更新
 * - audit_logs に privacy_policy_accepted を記録(法令対応用の証跡)
 *
 * 認可:認証済ユーザのみ。本人レコードに対する UPDATE は RLS の自身許可ポリシーで通る。
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("profiles")
    .update({
      privacy_policy_accepted_at: nowIso,
      privacy_policy_version: CURRENT_PRIVACY_POLICY_VERSION,
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  await recordAuditLog({
    userId: user.id,
    action: "privacy_policy_accepted",
    metadata: {
      version: CURRENT_PRIVACY_POLICY_VERSION,
      email: user.email ?? null,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    acceptedAt: nowIso,
    version: CURRENT_PRIVACY_POLICY_VERSION,
  });
}
