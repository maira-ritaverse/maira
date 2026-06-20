import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/tag-assignments/[lineUserId]
 * 指定 友達 に 付いて いる タグ ID 一覧。
 *
 * POST /api/agency/line/tag-assignments/[lineUserId]
 * 友達 に タグ を 紐付け 一括 同期 (tagIds 配列 で 完全置換)。
 */
type RouteContext = { params: Promise<{ lineUserId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  const { data } = await guard.supabase
    .from("line_conversation_tag_assignments")
    .select("tag_id")
    .eq("line_user_id", lineUserId);

  const tagIds = ((data ?? []) as Array<{ tag_id: string }>).map((r) => r.tag_id);
  return NextResponse.json({ tagIds });
}

const postBody = z.object({
  tagIds: z.array(z.string().uuid()).max(50),
});

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const tagIds = parsed.data.tagIds;

  const admin = createServiceClient();

  // 自組織 の tag のみ 受け入れる
  if (tagIds.length > 0) {
    const { data: validTags } = await admin
      .from("line_conversation_tags")
      .select("id")
      .eq("organization_id", guard.organization.id)
      .in("id", tagIds);
    const validIds = new Set(((validTags ?? []) as Array<{ id: string }>).map((t) => t.id));
    if (validIds.size !== tagIds.length) {
      return NextResponse.json({ error: "tag_not_in_org" }, { status: 403 });
    }
  }

  // 完全置換:既存 削除 → 新規 INSERT
  await admin
    .from("line_conversation_tag_assignments")
    .delete()
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId);

  if (tagIds.length > 0) {
    const rows = tagIds.map((tag_id) => ({
      organization_id: guard.organization.id,
      line_user_id: lineUserId,
      tag_id,
      assigned_by_user_id: guard.user.id,
    }));
    const { error } = await admin.from("line_conversation_tag_assignments").insert(rows);
    if (error) {
      return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, tagIds });
}
