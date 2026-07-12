/**
 * /api/agency/settings/email
 *
 * 組織単位で持ち込む Resend 設定(BYO)。
 *
 *  GET    :現在の設定状況(from + has_api_key)を返す(キー本体は絶対に返さない)
 *  PATCH  :from / api_key を更新(キーは AES-256-GCM で暗号化して保存)
 *  DELETE :設定をクリア(env にフォールバック)
 *
 * 認可 : organization_admin のみ。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { looksLikeResendKey } from "@/lib/email/resend";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const { data } = await guard.supabase
    .from("organizations")
    .select("email_from, resend_api_key_encrypted")
    .eq("id", guard.organization.id)
    .maybeSingle();

  const row = data as {
    email_from: string | null;
    resend_api_key_encrypted: string | null;
  } | null;

  return NextResponse.json({
    email_from: row?.email_from ?? null,
    // 平文は絶対に返さない。 「設定済みかどうか」だけを bool で返す。
    has_api_key: Boolean(row?.resend_api_key_encrypted),
  });
}

const patchBody = z.object({
  /** 送信元アドレス(例: recruit@abc-agency.co.jp)。 明示的に空文字で「クリア」もできる。 */
  email_from: z.string().max(200).optional(),
  /** Resend の API キー。 未指定なら既存キーを保持。 空文字で「クリア」。 */
  resend_api_key: z.string().max(200).optional(),
});

export async function PATCH(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};

  if (parsed.data.email_from !== undefined) {
    const trimmed = parsed.data.email_from.trim();
    if (trimmed === "") {
      patch.email_from = null;
    } else {
      // 最低限のフォーマット確認(細かい検証は Resend が返すエラーに委ねる)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return NextResponse.json({ error: "invalid_email_format" }, { status: 400 });
      }
      patch.email_from = trimmed;
    }
  }

  if (parsed.data.resend_api_key !== undefined) {
    const trimmed = parsed.data.resend_api_key.trim();
    if (trimmed === "") {
      patch.resend_api_key_encrypted = null;
    } else {
      if (!looksLikeResendKey(trimmed)) {
        return NextResponse.json({ error: "invalid_api_key_format" }, { status: 400 });
      }
      patch.resend_api_key_encrypted = await encryptField(trimmed);
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { error } = await admin.from("organizations").update(patch).eq("id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const admin = createServiceClient();
  const { error } = await admin
    .from("organizations")
    .update({ email_from: null, resend_api_key_encrypted: null })
    .eq("id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
