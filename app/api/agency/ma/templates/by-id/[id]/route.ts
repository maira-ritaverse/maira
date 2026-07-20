/**
 * PATCH /api/agency/ma/templates/[id]
 *
 * テンプレートの本文(と任意で name)を更新する。
 * Flow エディタで担当者がステップのメッセージを直接編集するために使う。
 *
 * ・organization_admin のみ
 * ・本文は AES-256-GCM で再暗号化して encrypted_body に保存
 * ・自組織の template しか触れないよう organization_id で二重防御
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getEntitlementsForOrg, planUpgradeRequired, requireOrgAdmin } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const patchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(4000).optional(),
  /** メール Flow 用の件名。 LINE Flow では未使用だが保存はする(将来切替時に流用可能)。 */
  subject: z.string().max(200).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  // MA 機能 は Team 系 プラン 限定 (Solo 系 は 402)。
  const entitlements = await getEntitlementsForOrg(guard.supabase);
  if (!entitlements.canUseMaFlows) {
    return planUpgradeRequired(
      "マーケティングオートメーション機能はTeamプラン以上でご利用いただけます。",
    );
  }

  const { id: templateId } = await context.params;
  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.body !== undefined) {
    patch.encrypted_body = await encryptField(parsed.data.body);
  }
  if (parsed.data.subject !== undefined) {
    patch.encrypted_subject = await encryptField(parsed.data.subject);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("ma_templates")
    .update(patch)
    .eq("id", templateId)
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
