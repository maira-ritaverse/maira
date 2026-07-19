import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/assignee/[lineUserId]
 * 担当者 を 設定 / 解除。
 *
 * 入力:{ assigneeUserId: uuid | null }
 * null で 担当者 解除。
 */
type RouteContext = { params: Promise<{ lineUserId: string }> };

const body = z.object({
  assigneeUserId: z.string().uuid().nullable(),
});

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { assigneeUserId } = parsed.data;

  // 自組織 の member か 確認 (null は スキップ)
  if (assigneeUserId !== null) {
    const { data: m } = await guard.supabase
      .from("organization_members")
      .select("user_id")
      .eq("user_id", assigneeUserId)
      // soft delete された メンバー は 担当 に 割り当て 不可
      .is("removed_at", null)
      .maybeSingle();
    if (!m) {
      return NextResponse.json({ error: "not_org_member" }, { status: 403 });
    }
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("line_user_links")
    .update({
      assigned_to_user_id: assigneeUserId,
      assigned_at: assigneeUserId ? new Date().toISOString() : null,
      assigned_by_user_id: assigneeUserId ? guard.user.id : null,
    })
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, assigneeUserId });
}
