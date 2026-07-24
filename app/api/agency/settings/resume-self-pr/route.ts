import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/settings/resume-self-pr
 *
 * 履歴書エディタで「自己PR」欄を使うかの組織単位フラグ(organizations.resume_self_pr_enabled)を
 * 更新する。組織単位の共有設定(会社の方針として揃える用途)なので、同組織メンバーが切り替えられる。
 * 既定は false(オフ)。一度オンにすればオン、オフにすればオフを保持する。
 *
 * 入力: { enabled: boolean }
 */
const bodySchema = z.object({ enabled: z.boolean() });

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  // organizations の更新は service_role で行う(認可は requireOrgMember 済み、
  // 対象は自組織 id のみに限定)。
  const service = createServiceClient();
  const { error } = await service
    .from("organizations")
    .update({ resume_self_pr_enabled: parsed.data.enabled })
    .eq("id", organization.id);
  if (error) {
    return NextResponse.json(
      {
        error: "update_failed",
        message: "設定の保存に失敗しました。時間を置いて再度お試しください。",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
}
