import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit/audit-log";
import { requireUser } from "@/lib/api/auth-guards";
import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * DELETE /api/admin/users/[id]
 *
 * 運営者用:指定ユーザを auth.users から完全削除(連鎖で profiles + 各テーブル)。
 *
 * 安全策:
 *   - 認証 + isMairaAdmin() ガード
 *   - 自分自身を消す操作は拒否(404 ではなく 400 で明示)
 *   - 別の運営者(is_maira_admin=true)を消す場合も実行可だが、監査ログに記録する
 *   - 監査ログは削除前に書く(profiles → audit_logs.user_id が SET NULL に倒れるため、
 *     metadata にメアドと target_user_id を残す)
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user: actor } = guard;

  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: targetId } = await params;
  if (targetId === actor.id) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  const admin = createServiceClient();

  // ターゲットのメアドを取得(監査ログ用)
  let targetEmail: string | null = null;
  try {
    const { data, error } = await admin.auth.admin.getUserById(targetId);
    if (error || !data?.user) {
      return NextResponse.json({ error: "target_not_found" }, { status: 404 });
    }
    targetEmail = data.user.email ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: "lookup_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  // 監査ログ(削除前)
  await recordAuditLog({
    userId: targetId,
    action: "admin_force_deleted_user",
    metadata: {
      target_email: targetEmail,
      target_user_id: targetId,
      deleted_by_user_id: actor.id,
      deleted_by_email: actor.email ?? null,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  // auth.users 削除 → cascade で全削除
  try {
    const { error } = await admin.auth.admin.deleteUser(targetId);
    if (error) {
      return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "delete_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, targetEmail });
}
