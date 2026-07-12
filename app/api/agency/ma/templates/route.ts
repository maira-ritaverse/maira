/**
 * /api/agency/ma/templates
 *
 * POST :独立 テンプレ (scenario_id NULL) を 作成。 AI Flow 生成 で send_message
 *       ステップ の テンプレ を 自動 作成 する ため に 使用。
 *
 * 認可 :organization admin のみ
 *
 * 暗号化 :
 *   ・encrypted_body:AES-256-GCM で 暗号化 (v{n}:base64url 形式)
 *   ・encrypted_subject:LINE では 使わ ない ので 空 文字 の 暗号 (法 上 の
 *     NOT NULL 対応)
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const postBody = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
});

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  const encryptedBody = await encryptField(parsed.data.body);
  const encryptedSubject = await encryptField(""); // LINE では 未使用

  const { data, error } = await admin
    .from("ma_templates")
    .insert({
      organization_id: guard.organization.id,
      scenario_id: null,
      name: parsed.data.name,
      encrypted_body: encryptedBody,
      encrypted_subject: encryptedSubject,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
