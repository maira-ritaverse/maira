import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit/audit-log";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/users/[id]
 *
 * 運営者用:指定ユーザのアーカイブ / 復活操作(ソフトデリート方式)。
 * profiles.archived_at に値を入れて「停止中」として扱う(auth.users は残す)。
 *
 * Body:
 *   { action: "archive" | "unarchive", reason?: string }
 *
 * 補足:
 *   ・物理削除は DELETE エンドポイントで別途。基本はアーカイブを使う。
 *   ・自分自身のアーカイブは拒否(管理画面から自滅できないように)
 */
const patchSchema = z.object({
  action: z.enum(["archive", "unarchive"]),
  reason: z.string().max(500).optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user: actor } = guard;

  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = patchSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const { id: targetId } = await params;
  if (targetId === actor.id && parsed.data.action === "archive") {
    return NextResponse.json({ error: "cannot_archive_self" }, { status: 400 });
  }

  const admin = createServiceClient();

  const update =
    parsed.data.action === "archive"
      ? {
          archived_at: new Date().toISOString(),
          archived_reason: parsed.data.reason ?? null,
        }
      : { archived_at: null, archived_reason: null };

  const { error } = await admin.from("profiles").update(update).eq("id", targetId);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  await recordAuditLog({
    userId: targetId,
    action: "admin_accessed_user",
    metadata: {
      event_subtype:
        parsed.data.action === "archive" ? "admin_archived_user" : "admin_unarchived_user",
      target_user_id: targetId,
      reason: parsed.data.reason ?? null,
      operator_user_id: actor.id,
      operator_email: actor.email ?? null,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/users/[id]
 *
 * 運営者用:指定ユーザを auth.users から完全削除(連鎖で profiles + 各テーブル)。
 *
 * ⚠️ これは物理削除で不可逆。管理画面のデフォルトは PATCH(アーカイブ)を使うこと。
 * 物理削除はデータ整理が本当に必要な場合のみ運営側で別途実行する。
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
