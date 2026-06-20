import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";

/**
 * PATCH /api/agency/line/user-links/[lineUserId]
 *
 * LINE 友達 の カスタム 表示名 (line_user_links.custom_name) を 更新。
 * 空文字 を 渡せば null に 戻して LINE プロフィール名 (display_name) を
 * 使う 状態 に 戻る。
 *
 * 認可: requireOrgMember + RLS で 自組織 のみ 更新 可。
 */
// PATCH ルート は 静的化 不可 だ が、 念のため 明示 (Vercel ビルド での 解釈 安定 化)
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ lineUserId: string }> };

const bodySchema = z.object({
  customName: z.string().max(60).nullable(),
});

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: raw } = await context.params;
  const lineUserId = decodeURIComponent(raw);

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 空文字 → null 正規化 (LINE プロフィール名 を 使う)
  const value = parsed.data.customName?.trim() ? parsed.data.customName.trim() : null;

  const { data, error } = await guard.supabase
    .from("line_user_links")
    .update({ custom_name: value })
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId)
    .select("line_user_id, display_name, custom_name")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, link: data });
}
