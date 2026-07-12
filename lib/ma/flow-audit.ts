/**
 * Flow 操作の監査ログ記録 + 取得ヘルパー。
 *
 * ・書き込みは service client で行う(RLS を通さず、アプリ層で org を保証)
 * ・機密の中身(暗号化本文・タグ値等)は diff_summary に含めない
 * ・失敗はログのみで握り潰す(本流のリクエストを止めない)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type FlowAuditAction =
  | "create"
  | "update_meta"
  | "update_steps"
  | "toggle_active"
  | "delete";

export type FlowAuditRow = {
  id: string;
  flow_id: string | null;
  action: FlowAuditAction;
  actor_user_id: string | null;
  actor_display_name: string | null;
  diff_summary: Record<string, unknown>;
  occurred_at: string;
};

/**
 * 監査ログを 1 件記録する。失敗しても呼び出し側には影響させない。
 */
export async function logFlowAudit(
  admin: SupabaseClient,
  params: {
    organization_id: string;
    flow_id: string | null;
    action: FlowAuditAction;
    actor_user_id: string | null;
    diff_summary?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("ma_flow_audit_logs").insert({
      organization_id: params.organization_id,
      flow_id: params.flow_id,
      action: params.action,
      actor_user_id: params.actor_user_id,
      diff_summary: params.diff_summary ?? {},
    });
  } catch (err) {
    console.error("[flow-audit] logFlowAudit failed", {
      ...params,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 特定 Flow の監査ログを新しい順で取得。 表示用に actor の display_name も join。
 * 個人情報として display_name しか出さない(email 等は出さない)。
 */
export async function listFlowAuditByFlow(
  supabase: SupabaseClient,
  organizationId: string,
  flowId: string,
  limit = 30,
): Promise<FlowAuditRow[]> {
  const { data } = await supabase
    .from("ma_flow_audit_logs")
    .select("id, flow_id, action, actor_user_id, diff_summary, occurred_at")
    .eq("organization_id", organizationId)
    .eq("flow_id", flowId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<Omit<FlowAuditRow, "actor_display_name">>;
  if (rows.length === 0) return [];

  const actorIds = Array.from(
    new Set(rows.map((r) => r.actor_user_id).filter((v): v is string => v != null)),
  );
  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", actorIds);
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string | null }>) {
      if (p.display_name) nameById.set(p.id, p.display_name);
    }
  }
  return rows.map((r) => ({
    ...r,
    actor_display_name: r.actor_user_id ? (nameById.get(r.actor_user_id) ?? null) : null,
  }));
}

/** action → 日本語ラベル */
export function labelForAuditAction(action: string): string {
  switch (action) {
    case "create":
      return "作成";
    case "update_meta":
      return "詳細設定を編集";
    case "update_steps":
      return "ステップを変更";
    case "toggle_active":
      return "有効・停止を切替";
    case "delete":
      return "削除";
    default:
      return action;
  }
}
