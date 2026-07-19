/**
 * クライアント変更履歴(client_audit_log)の型 + クエリヘルパー。
 *
 * DB スキーマは supabase/migrations/20260615150001_add_client_audit_log.sql。
 * 追記専用ログ(UPDATE / DELETE は RLS で拒否)。
 *
 * 暗号化フィールドの値はここでも old_value / new_value に書き込まない方針:
 *   - 平文を取得済みのレイヤー(API ルート内の decrypt 後)で呼ぶ場合でも、
 *     セキュリティ要件から「ログには値を残さない」を徹底する。
 *   - 暗号化フィールドが変わった場合は new/old は null のまま、field_name のみ記録する。
 */
import { createClient } from "@/lib/supabase/server";

export type AuditAction = "create" | "update" | "delete";

export type ClientAuditLogEntry = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  actorMemberId: string | null;
  actorName: string | null;
  action: AuditAction;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

type ClientAuditLogRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  actor_member_id: string | null;
  action: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

function rowToEntry(row: ClientAuditLogRow, actorName: string | null): ClientAuditLogEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    actorMemberId: row.actor_member_id,
    actorName,
    action: row.action as AuditAction,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    createdAt: row.created_at,
  };
}

/**
 * フィールド変更を 1 件記録する。
 * - 値が同じなら何もしない(呼び出し側で diff を取らない手間を吸収)。
 * - 暗号化フィールドの値は呼び出し側で null を渡すこと。
 */
export type LogChangeInput = {
  organizationId: string;
  clientRecordId: string;
  actorMemberId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
};

/**
 * 求職者 の 新規作成 を 1 行 記録する。
 *
 * 目的:
 *   ・Phase 2 (CA 個人 信頼スコア) の 「データ 品質 = 誰 が プロフィール を
 *     埋めた か」 の 起点 を 追跡する
 *   ・client_records.created_by_member_id と 二重化 に なる が、 audit_log は
 *     「作成 イベント の 時刻」も 記録する 意味 が ある (プロフィール が 後で
 *     埋め られた 場合 の delta 分析)
 *
 * field_name は "__create__" 固定、 old_value / new_value は null。
 * public intake form 経由 の セルフ 登録 (actor が null) の 場合 は 記録 しない
 * (RLS 側 も actor_member_id が nullable なので DB に は 入る が、 集計 上 意味
 *  を 持たない ため)。
 *
 * エラーは 握って warn のみ (監査 ログ 失敗 で 本処理 が 落ちない よう)。
 */
export async function logClientCreate(base: {
  organizationId: string;
  clientRecordId: string;
  actorMemberId: string | null;
}): Promise<void> {
  if (!base.actorMemberId) return;
  const supabase = await createClient();
  const { error } = await supabase.from("client_audit_log").insert({
    organization_id: base.organizationId,
    client_record_id: base.clientRecordId,
    actor_member_id: base.actorMemberId,
    action: "create" as AuditAction,
    field_name: "__create__",
    old_value: null,
    new_value: null,
  });
  if (error) {
    console.warn("[audit] client_audit_log create insert failed:", error.message);
  }
}

/**
 * 複数フィールド変更を 1 トランザクションで記録する。
 * - 値が同じフィールドはスキップ。
 * - null vs null や undefined は「未変更」として扱う。
 * - エラーは握って警告のみ(監査ログ失敗で本処理が落ちる事故を防ぐ)。
 */
export async function logClientChanges(
  base: Omit<LogChangeInput, "fieldName" | "oldValue" | "newValue">,
  changes: Array<{ fieldName: string; oldValue: string | null; newValue: string | null }>,
): Promise<void> {
  const diff = changes.filter((c) => c.oldValue !== c.newValue);
  if (diff.length === 0) return;

  const supabase = await createClient();
  const rows = diff.map((c) => ({
    organization_id: base.organizationId,
    client_record_id: base.clientRecordId,
    actor_member_id: base.actorMemberId,
    action: "update" as AuditAction,
    field_name: c.fieldName,
    old_value: c.oldValue,
    new_value: c.newValue,
  }));

  const { error } = await supabase.from("client_audit_log").insert(rows);
  if (error) {
    // 監査ログの書き込み失敗で本処理を巻き戻すと UX が悪化するので、警告だけ残す。
    console.warn("[audit] client_audit_log insert failed:", error.message);
  }
}

/**
 * 1 クライアントの変更履歴を時刻降順で取得する。
 * actorName は別 RPC(list_organization_member_display_names)で合流。
 */
export async function listClientAuditLog(
  clientRecordId: string,
  organizationId: string,
): Promise<ClientAuditLogEntry[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("client_audit_log")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .order("created_at", { ascending: false })
    .limit(200); // 詳細画面で 200 件以上は閲覧負荷が高い。古いものはコンプライアンス監査でのみ参照する想定

  if (error || !rows) return [];

  // 表示名 Map(RLS バイパス RPC 経由)
  const { data: memberRows } = await supabase.rpc("list_organization_member_display_names", {
    target_organization_id: organizationId,
  });

  const nameByMemberId = new Map<string, string | null>();
  if (memberRows) {
    for (const r of memberRows as Array<{ member_id: string; display_name: string | null }>) {
      nameByMemberId.set(r.member_id, r.display_name);
    }
  }

  return (rows as ClientAuditLogRow[]).map((row) =>
    rowToEntry(row, row.actor_member_id ? (nameByMemberId.get(row.actor_member_id) ?? null) : null),
  );
}
