/**
 * 求職者本人視点の連携(client_records)取得ヘルパー
 *
 * 認可は RLS(20260607000005_add_client_link_rpcs.sql)で行う:
 *   - 本人は「メール一致の invited 行」(Invited seeker can view ... by email)
 *   - 本人は「linked_user_id = auth.uid() の linked 行」(Linked seeker can view ...)
 * の 2 経路で自分の連携行を SELECT できる。revoked 行は linked_user_id を残した
 * まま link_status='revoked' になるので、linked と同じポリシー対象として見える。
 *
 * 注意:revoked 行は本人の閲覧経路を残すため、Phase 2 の revoke_client_link が
 * linked_user_id をクリアしていない(履歴として残す方針)。本ヘルパーはそれを
 * 前提に linked と revoked を同じ select で拾う。
 */

import { createClient } from "@/lib/supabase/server";
import type { ClientLinkStatus } from "@/lib/clients/types";
import type { Connection, ConnectionsByStatus } from "./types";

type ClientRecordRow = {
  id: string;
  organization_id: string;
  link_status: ClientLinkStatus;
  linked_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

// 本人 UI に必要な列だけを明示。SELECT * すると notes / status などエージェント
// 都合の列まで返ってきて、ログや将来の見直しのときに「何を本人に渡しているか」が
// 分かりにくくなる。
const SELECT_COLUMNS =
  "id, organization_id, link_status, linked_at, revoked_at, created_at, updated_at";

function rowToConnection(row: ClientRecordRow): Connection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    linkStatus: row.link_status,
    linkedAt: row.linked_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 認証ユーザー本人の連携一覧を状態別に取得する。
 *
 * RLS で見える行のみが返るため、本人以外の連携情報は混じらない。
 * 並び順は状態ごとに「最近のものが上」になるよう updated_at desc を使う:
 *   - invited:招待が来た新しい順に上
 *   - linked :連携した新しい順に上
 *   - revoked:解除した新しい順に上
 */
export async function listConnections(): Promise<ConnectionsByStatus> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select(SELECT_COLUMNS)
    .in("link_status", ["invited", "linked", "revoked"])
    .order("updated_at", { ascending: false });

  if (error || !data) {
    return { invited: [], linked: [], revoked: [] };
  }

  const rows = data as ClientRecordRow[];
  const buckets: ConnectionsByStatus = { invited: [], linked: [], revoked: [] };
  for (const row of rows) {
    const conn = rowToConnection(row);
    if (conn.linkStatus === "invited") buckets.invited.push(conn);
    else if (conn.linkStatus === "linked") buckets.linked.push(conn);
    else if (conn.linkStatus === "revoked") buckets.revoked.push(conn);
    // unlinked は RLS で本人から見えないので分岐不要(防御的に else を切らない)
  }
  return buckets;
}

/**
 * 認証ユーザー本人宛ての invited 件数。サイドナビのバッジ用。
 *
 * 別クエリにする理由:
 *   layout.tsx で呼ぶときに、ナビ表示のためだけに「全連携の中身」を取りたく
 *   ないため。head: true で行データは転送せず count のみ返す。
 */
export async function countInvitedConnections(): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("client_records")
    .select("id", { count: "exact", head: true })
    .eq("link_status", "invited");

  if (error) return 0;
  return count ?? 0;
}
