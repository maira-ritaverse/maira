/**
 * MA 機能の同意 / 撤回 API
 *
 *   POST   /api/agency/ma/consent  → 同意を新規追加
 *   DELETE /api/agency/ma/consent  → 現在有効な同意を撤回
 *
 * 認可:
 *   - 両方とも admin のみ(法令遵守の約束は管理者責任)
 *
 * 設計:
 *   - 同意・撤回ともに ma_consent_log への INSERT / UPDATE のみ。delete はしない(監査ログ)。
 *   - consent_version はクライアントから送られてくるが、サーバー側で
 *     CURRENT_EMAIL_MA_CONSENT_VERSION と一致するかを検証する
 *     (古い特約バージョンへの同意は受け付けない)。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { recordConsent, revokeConsent } from "@/lib/ma/queries";
import {
  CURRENT_EMAIL_MA_CONSENT_VERSION,
  recordConsentSchema,
  revokeConsentSchema,
} from "@/lib/ma/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const parsed = recordConsentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 特約バージョンの検証。クライアントから送られた値が最新でなければ拒否する。
  // 将来 line_ma 用の定数も追加されたら feature 分岐で参照を変える。
  if (parsed.data.feature === "email_ma") {
    if (parsed.data.consentVersion !== CURRENT_EMAIL_MA_CONSENT_VERSION) {
      return NextResponse.json(
        {
          error: "Outdated consent version",
          message: `現在の特約バージョンは ${CURRENT_EMAIL_MA_CONSENT_VERSION} です。`,
        },
        { status: 400 },
      );
    }
  } else {
    // line_ma は Phase C-4 で実装予定。今は 501 で明示。
    return NextResponse.json(
      { error: "Not implemented", message: `feature=${parsed.data.feature} は未実装です。` },
      { status: 501 },
    );
  }

  try {
    const entry = await recordConsent({
      organizationId: role.organization.id,
      acceptedByMemberId: role.member.id,
      feature: parsed.data.feature,
      consentVersion: parsed.data.consentVersion,
    });
    return NextResponse.json({ consent: entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to record consent", message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const parsed = revokeConsentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    await revokeConsent({
      organizationId: role.organization.id,
      revokedByMemberId: role.member.id,
      feature: parsed.data.feature,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to revoke consent", message }, { status: 500 });
  }
}
