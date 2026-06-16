/**
 * 監査ログ(audit_logs)への書き込みヘルパ
 *
 * 設計方針:
 *   - 書き込み権限は service_role のみ(マイグレーション 20260518000003_setup_rls.sql)。
 *     ただし通常の API ルートでは createClient() 経由の anon-key client を使う。
 *     -> 監査ログ INSERT は専用に service-role client を発行する。
 *   - 記録に失敗してもメイン処理は止めない(監査ログの失敗で削除 / ログインが阻害されるのは本末転倒)。
 *     失敗時は console.error してアラート対象にする。
 *   - 削除後の監査ログを残すため、metadata に email / display_name を冗長保存する運用。
 *     (FK は SET NULL に変更済み、20260616000001_audit_logs_nullable_and_extend.sql)
 *
 * 使い方:
 *   await recordAuditLog({
 *     userId: user.id,            // 操作対象。NULL も可(削除後の記録など)
 *     action: "account_deleted",
 *     metadata: { email, reason },
 *     ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
 *     userAgent: req.headers.get("user-agent") ?? undefined,
 *   });
 */
import { createServiceClient } from "@/lib/supabase/service";

/** audit_action enum と同期(マイグレーション参照) */
export type AuditAction =
  | "login"
  | "logout"
  | "password_changed"
  | "recovery_key_regenerated"
  | "data_exported"
  | "account_deleted"
  | "subscription_changed"
  | "admin_force_deleted_user"
  | "account_export_requested"
  | "privacy_policy_accepted"
  | "admin_accessed_user";

export type RecordAuditLogInput = {
  /** 操作対象ユーザ。NULL の場合は metadata に追跡情報を入れる */
  userId: string | null;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * 監査ログを 1 行書き込む。失敗してもメイン処理を止めず、ログだけ吐く。
 *
 * NextRequest からの呼出例:
 *   await recordAuditLog({
 *     userId, action: "login",
 *     ipAddress: req.headers.get("x-forwarded-for"),
 *     userAgent: req.headers.get("user-agent"),
 *   });
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("audit_logs").insert({
      user_id: input.userId,
      action: input.action,
      metadata: input.metadata ?? null,
      ip_address: normalizeIp(input.ipAddress),
      user_agent: input.userAgent ?? null,
    });
    if (error) {
      console.error("[audit-log] insert failed:", error.message, { action: input.action });
    }
  } catch (err) {
    console.error("[audit-log] unexpected failure:", err, { action: input.action });
  }
}

/**
 * x-forwarded-for は ", " 区切りで複数 IP が来るため、先頭(クライアント直 IP)だけ採用。
 * inet 型の PostgreSQL カラムに不正値が入ると行ごと弾かれるので、空文字は NULL に倒す。
 */
function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
}
