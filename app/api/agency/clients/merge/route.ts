import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * POST /api/agency/clients/merge
 *
 * 顧客レコードのマージ(admin 限定)。
 * 全ての関連レコード(対応履歴 / タスク / 応募 / 監査 / MA / 閲覧記録)を
 * target に付け替え、source を削除する。トランザクションは RPC 内で完結する。
 *
 * Body:
 *   { sourceId: uuid, targetId: uuid }
 *
 * 認可:
 *   - organization_member + admin
 *   - RPC 側で source/target ともに自組織であることも検証(二重防御)
 */

const requestSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (role.member.role !== "admin") {
    return NextResponse.json({ error: "マージは admin 権限が必要です" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { sourceId, targetId } = parsed.data;
  if (sourceId === targetId) {
    return NextResponse.json({ error: "Source と target が同じです" }, { status: 400 });
  }

  // RPC でトランザクション境界をまとめて実行
  const { error } = await supabase.rpc("merge_client_records", {
    source_id: sourceId,
    target_id: targetId,
  });
  if (error) {
    return NextResponse.json({ error: "マージ失敗", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, mergedFromId: sourceId, mergedIntoId: targetId });
}
