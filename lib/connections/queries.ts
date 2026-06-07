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
  // P3 で追加。revoke_requested 状態のときに申請時刻と猶予期限を持つ。
  // それ以外の状態では DB 側で null のまま。
  revoke_requested_at: string | null;
  revoke_deadline: string | null;
  created_at: string;
  updated_at: string;
  // PostgREST の外部キー埋め込み。organizations(id) への関係に基づき
  // organization name と revoke_grace_days を join 取得。
  // - name: Phase 4 で追加した organizations の限定 SELECT ポリシーで取れる
  // - revoke_grace_days: P3 で申請ダイアログに「最大 N 日」を出すため
  // RLS で organization 行が見えなければ両方 null になる。
  organizations: { name: string; revoke_grace_days: number } | null;
};

// 本人 UI に必要な列だけを明示。SELECT * すると notes / status などエージェント
// 都合の列まで返ってきて、ログや将来の見直しのときに「何を本人に渡しているか」が
// 分かりにくくなる。
// organizations(name, revoke_grace_days) は PostgREST の埋め込みで join 取得。
// client_records.organization_id → organizations.id の FK で関係解決される。
const SELECT_COLUMNS =
  "id, organization_id, link_status, linked_at, revoked_at, revoke_requested_at, revoke_deadline, created_at, updated_at, organizations(name, revoke_grace_days)";

function rowToConnection(row: ClientRecordRow): Connection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organizations?.name ?? null,
    graceDays: row.organizations?.revoke_grace_days ?? null,
    linkStatus: row.link_status,
    linkedAt: row.linked_at,
    revokedAt: row.revoked_at,
    revokeRequestedAt: row.revoke_requested_at,
    revokeDeadline: row.revoke_deadline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 認証ユーザー本人の連携一覧を状態別に取得する。
 *
 * RLS で見える行のみが返るため、本人以外の連携情報は混じらない。
 * 並び順は状態ごとに「最近のものが上」になるよう updated_at desc を使う:
 *   - invited         :招待が来た新しい順に上
 *   - linked          :連携した新しい順に上
 *   - revoke_requested:申請日時の新しい順に上
 *   - revoked         :解除した新しい順に上
 *
 * P3 で revoke_requested を取得対象に追加。「解除を申請したが猶予期間内」の
 * 連携を「申請中」セクションで表示するため。期限超過しても link_status は
 * revoke_requested のまま(本人 SELECT は時刻条件なし)なので、deadline 経過後
 * も本セクションに残る(deadline の表示が「期限切れ」になる)。
 */
export async function listConnections(): Promise<ConnectionsByStatus> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select(SELECT_COLUMNS)
    .in("link_status", ["invited", "linked", "revoke_requested", "revoked"])
    .order("updated_at", { ascending: false });

  if (error || !data) {
    return { invited: [], linked: [], revokeRequested: [], revoked: [] };
  }

  // PostgREST の埋め込み結果型は `unknown` 寄りに来るため、明示キャストで
  // ClientRecordRow に詰める。エラー時の早期 return は上で済んでいる。
  const rows = data as unknown as ClientRecordRow[];
  const buckets: ConnectionsByStatus = {
    invited: [],
    linked: [],
    revokeRequested: [],
    revoked: [],
  };
  for (const row of rows) {
    const conn = rowToConnection(row);
    if (conn.linkStatus === "invited") buckets.invited.push(conn);
    else if (conn.linkStatus === "linked") buckets.linked.push(conn);
    else if (conn.linkStatus === "revoke_requested") buckets.revokeRequested.push(conn);
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
