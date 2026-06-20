import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/welcome
 * 自動 歓迎 メッセージ の 現在 設定 を 返す (本文 は 復号 して 返す)。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data } = await guard.supabase
    .from("line_channels")
    .select("welcome_message_enabled, welcome_message_encrypted")
    .maybeSingle();
  const row = data as {
    welcome_message_enabled: boolean;
    welcome_message_encrypted: string | null;
  } | null;
  if (!row) {
    return NextResponse.json({ enabled: false, text: "" });
  }
  const text = row.welcome_message_encrypted
    ? ((await decryptField(row.welcome_message_encrypted)) ?? "")
    : "";
  return NextResponse.json({ enabled: row.welcome_message_enabled, text });
}

/**
 * POST /api/agency/line/welcome
 * 自動 歓迎 メッセージ を 更新 (admin 限定)。
 */
const bodySchema = z.object({
  enabled: z.boolean(),
  text: z.string().max(5000),
});

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { enabled, text } = parsed.data;

  // 「有効 だが 本文 空」は 不可
  if (enabled && text.trim().length === 0) {
    return NextResponse.json({ error: "text_required_when_enabled" }, { status: 400 });
  }

  const encrypted = text.length > 0 ? await encryptField(text) : null;

  const admin = createServiceClient();
  const { error } = await admin
    .from("line_channels")
    .update({
      welcome_message_enabled: enabled,
      welcome_message_encrypted: encrypted,
    })
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
