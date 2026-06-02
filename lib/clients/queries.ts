/**
 * クライアントレコード(企業所有)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業のクライアントのみが返る。
 * (求職者本人は、自分に紐づいた linked 状態のレコードのみ閲覧可)
 */

import { createClient } from "@/lib/supabase/server";
import type {
  ClientRecord,
  ClientRecordWithAssignee,
  ClientRecordWithAssigneeAndDues,
} from "./types";

type ClientRecordRow = {
  id: string;
  organization_id: string;
  assigned_member_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  link_status: string;
  linked_user_id: string | null;
  linked_at: string | null;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function rowToClientRecord(row: ClientRecordRow): ClientRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    assignedMemberId: row.assigned_member_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status as ClientRecord["status"],
    linkStatus: row.link_status as ClientRecord["linkStatus"],
    linkedUserId: row.linked_user_id,
    linkedAt: row.linked_at,
    revokedAt: row.revoked_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 企業のクライアント一覧を取得
 * RLS により、自社のクライアントのみ取得される
 */
export async function listClientRecords(organizationId: string): Promise<ClientRecord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as ClientRecordRow[]).map(rowToClientRecord);
}

/**
 * 単一のクライアントレコードを取得
 */
export async function getClientRecord(clientId: string): Promise<ClientRecord | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !data) return null;

  return rowToClientRecord(data as ClientRecordRow);
}

/**
 * 担当アドバイザー名を含む企業のクライアント一覧を取得
 *
 * 一覧テーブル表示用。listClientRecords と同じく RLS により
 * 自社のクライアントのみ返る。
 *
 * 担当者名の取得手順:
 *   1. client_records を取得
 *   2. SECURITY DEFINER 関数 list_organization_member_display_names で
 *      組織メンバーの (member_id, display_name) Map を作成
 *      (profiles の RLS は緩めずに display_name のみを公開するため)
 *   3. assigned_member_id をキーに表示名を合流
 *
 * 担当者未割当・display_name 未設定の場合は assigneeName = null。
 */
export async function listClientRecordsWithAssignee(
  organizationId: string,
): Promise<ClientRecordWithAssignee[]> {
  const supabase = await createClient();

  const { data: clientRows, error: clientError } = await supabase
    .from("client_records")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (clientError || !clientRows) return [];

  const clients = (clientRows as ClientRecordRow[]).map(rowToClientRecord);

  // 組織メンバーの表示名 Map を取得(RLS バイパス関数経由)
  const { data: memberRows, error: memberError } = await supabase.rpc(
    "list_organization_member_display_names",
    { target_organization_id: organizationId },
  );

  // メンバー名取得に失敗してもクライアント一覧自体は返す(担当者名のみ null)
  const nameByMemberId = new Map<string, string | null>();
  if (!memberError && memberRows) {
    for (const row of memberRows as Array<{ member_id: string; display_name: string | null }>) {
      nameByMemberId.set(row.member_id, row.display_name);
    }
  }

  return clients.map((client) => ({
    ...client,
    assigneeName: client.assignedMemberId
      ? (nameByMemberId.get(client.assignedMemberId) ?? null)
      : null,
  }));
}

/**
 * クライアント一覧 + 担当者名 + 「未完了タスクの期限リスト」
 *
 * N+1 回避のため、未完了タスクは organization スコープで「1回だけ」
 * 取得し、JS で client_record_id ごとに集約する。
 * タスクは 1 クライアントあたり数件想定なので、組織全体でも数百件以内が現実的。
 *
 * 期限超過/間近の判定はサーバではせず生の due_at のリストを返す。
 * 理由:画面表示後しばらく経つと「今」がズレるため、判定はクライアント側で
 * useNow と組み合わせて行う(期限色分けと同じ方針)。
 */
export async function listClientRecordsWithAssigneeAndDues(
  organizationId: string,
): Promise<ClientRecordWithAssigneeAndDues[]> {
  const supabase = await createClient();

  // 1. 既存ロジックでクライアント + 担当者名を取得
  const clients = await listClientRecordsWithAssignee(organizationId);

  // 2. 同 organization の未完了タスクを1クエリで取得
  //    select は必要最小限(client_record_id と due_at のみ)
  const { data: taskRows, error } = await supabase
    .from("agency_tasks")
    .select("client_record_id, due_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  if (error || !taskRows) {
    // タスク取得に失敗してもクライアント一覧自体は返す(バッジが出ないだけ)
    return clients.map((c) => ({ ...c, pendingDueAts: [] }));
  }

  // 3. client_record_id ごとに due_at を寄せる
  const duesByClientId = new Map<string, (string | null)[]>();
  for (const row of taskRows as Array<{ client_record_id: string; due_at: string | null }>) {
    const arr = duesByClientId.get(row.client_record_id) ?? [];
    arr.push(row.due_at);
    duesByClientId.set(row.client_record_id, arr);
  }

  return clients.map((c) => ({
    ...c,
    pendingDueAts: duesByClientId.get(c.id) ?? [],
  }));
}

/**
 * 担当アドバイザー別にクライアントを取得
 */
export async function listClientRecordsByAdvisor(
  organizationId: string,
  memberId: string,
): Promise<ClientRecord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("assigned_member_id", memberId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as ClientRecordRow[]).map(rowToClientRecord);
}
