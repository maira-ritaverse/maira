import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";

/**
 * PATCH /api/agency/settings/line-intro
 *
 * 自分 の LINE 自己 紹介 (ヘッド ライン + 本文) を 更新 する。
 * 顔 写真 は 別 エンドポイント (POST /api/agency/settings/line-intro/photo)。
 *
 * 認可:
 *   ・requireOrgMember (advisor / admin どちら も OK)
 *   ・自分 の organization_members 行 のみ 更新 (organization_id + user_id 縛り)
 *
 * Body: { headline: string | null, body: string | null }
 *   ・空文字 → null に 正規化
 *   ・headline は 120 字 まで、 body は 2,000 字 まで (Zod で 制限)
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  headline: z.string().max(120).nullable(),
  body: z.string().max(2000).nullable(),
});

export async function PATCH(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = bodySchema.safeParse(parsed.body);
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid_body", details: body.error.flatten() },
      { status: 400 },
    );
  }

  const headline = body.data.headline?.trim() || null;
  const rawBody = body.data.body?.trim() || null;
  const encryptedBody = rawBody ? await encryptField(rawBody) : null;

  const { error } = await supabase
    .from("organization_members")
    .update({
      line_intro_headline: headline,
      encrypted_line_intro_body: encryptedBody,
      line_intro_updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("organization_id", organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
