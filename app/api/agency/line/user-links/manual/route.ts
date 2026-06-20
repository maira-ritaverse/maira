import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { applyLinkedRichMenu, applyUnlinkedRichMenu } from "@/lib/line/rich-menu";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/user-links/manual
 *
 * line_user_id に client_record を 手動 紐付け / 解除 する。
 *   clientRecordId が 渡されたら → 紐付け (link_method='manual')
 *   clientRecordId が null なら → 解除
 *
 * client_record が 同 org の もの か 検証。
 */
const bodySchema = z.object({
  lineUserId: z.string().min(1).max(64),
  clientRecordId: z.string().uuid().nullable(),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { lineUserId, clientRecordId } = parsed.data;

  // line_user_links 行 が 自組織 に 存在 する か 確認
  const { data: linkRow, error: fetchErr } = await guard.supabase
    .from("line_user_links")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (fetchErr || !linkRow) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }

  // 紐付け 先 client_record が 自組織 の もの か 確認 (null 指定 は 解除 なので skip)
  if (clientRecordId !== null) {
    const { data: clientRow } = await guard.supabase
      .from("client_records")
      .select("id")
      .eq("id", clientRecordId)
      .maybeSingle();
    if (!clientRow) {
      return NextResponse.json({ error: "client_record_not_found" }, { status: 404 });
    }
  }

  // RLS では UPDATE 不可。 service_role 経由 で 更新。
  const admin = createServiceClient();
  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("line_user_links")
    .update({
      client_record_id: clientRecordId,
      linked_at: clientRecordId ? now : null,
      link_method: clientRecordId ? "manual" : null,
    })
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId);
  if (updateErr) {
    return NextResponse.json(
      { error: "update_failed", message: updateErr.message },
      { status: 500 },
    );
  }

  // 関連 line_messages の client_record_id も 一括 更新 (履歴 整合)
  await admin
    .from("line_messages")
    .update({ client_record_id: clientRecordId })
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId);

  // Rich Menu を 連携状態 に 応じて 自動 切替
  if (clientRecordId) {
    await applyLinkedRichMenu(admin, guard.organization.id, lineUserId);
  } else {
    await applyUnlinkedRichMenu(admin, guard.organization.id, lineUserId);
  }

  return NextResponse.json({ ok: true, lineUserId, clientRecordId });
}
