import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit/audit-log";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/account/delete
 *
 * 本人のアカウントを完全削除する(個人情報保護法 第34条 等の削除請求対応)。
 *
 * フロー:
 *   1. 認証(本人のみ)
 *   2. 確認文字列の検証(誤操作防止):「アカウントを削除します」
 *   3. 監査ログを INSERT(profile 削除前)
 *      → user_id は SET NULL になるので、metadata に email を保存
 *   4. service_role で auth.admin.deleteUser(user.id)
 *      → auth.users → profiles → 各テーブル on delete cascade で連鎖削除
 *   5. レスポンス { ok: true }、クライアント側でログアウト + リダイレクト
 *
 * 注意:
 *   - service_role を使うのは auth.users を消すため(通常の anon-key では消せない)。
 *     RLS をバイパスしないよう、削除対象は必ず本人(認証された user.id)に限定する。
 *   - 削除は不可逆。誤操作を防ぐため確認文字列を強制する。
 */

const deleteRequestSchema = z.object({
  // 「アカウントを削除します」と入力させて誤操作防止
  confirmText: z.string(),
});

const REQUIRED_CONFIRM_TEXT = "アカウントを削除します";

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = deleteRequestSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  if (parsed.data.confirmText.trim() !== REQUIRED_CONFIRM_TEXT) {
    return NextResponse.json(
      { error: "confirm_text_mismatch", required: REQUIRED_CONFIRM_TEXT },
      { status: 400 },
    );
  }

  // 削除前に監査ログ。profile 削除と同時に SET NULL になるので metadata で追跡。
  await recordAuditLog({
    userId: user.id,
    action: "account_deleted",
    metadata: {
      email: user.email ?? null,
      reason: "self_request",
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  // service-role で auth.users を削除 → cascade で全データ消去
  try {
    const admin = createServiceClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "delete_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
