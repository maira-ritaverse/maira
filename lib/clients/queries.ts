/**
 * クライアントレコード(企業所有)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業のクライアントのみが返る。
 * (求職者本人は、自分に紐づいた linked 状態のレコードのみ閲覧可)
 */

import { createClient } from "@/lib/supabase/server";
import type { ClientRecord } from "./types";

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
