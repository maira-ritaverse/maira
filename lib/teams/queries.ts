/**
 * 組織 team の 参照 系 クエリ ヘルパー。
 *
 * すべて RLS を 前提 と し、 呼び 出し 元 は 認証 済 の user session を 使う 想定。
 * team CRUD は SECURITY DEFINER RPC 経由 (queries に は 含めない)。
 */
import { createClient } from "@/lib/supabase/server";

import type {
  ClientTeamAssignment,
  OrganizationTeam,
  OrganizationTeamMember,
  OrganizationTeamWithCounts,
} from "./types";

type TeamRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

function rowToTeam(row: TeamRow): OrganizationTeam {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    color: row.color,
    sortOrder: row.sort_order,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 組織 の team 一覧 (sort_order 昇順 + name)。
 * RLS 上 は 同 org のみ 見え る。
 */
export async function listTeams(organizationId: string): Promise<OrganizationTeam[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_teams")
    .select(
      "id, organization_id, name, description, color, sort_order, created_by_member_id, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []).map((row) => rowToTeam(row as TeamRow));
}

/**
 * team + 集計 (member_count, client_count)。 管理 画面 一覧 で 使う。
 * count は 別 クエリ で 集計 (jsonb で groupBy 相当 が Supabase では 面倒 な ため)。
 */
export async function listTeamsWithCounts(
  organizationId: string,
): Promise<OrganizationTeamWithCounts[]> {
  const supabase = await createClient();
  const teams = await listTeams(organizationId);
  if (teams.length === 0) return [];

  const teamIds = teams.map((t) => t.id);
  const [memberCounts, clientCounts] = await Promise.all([
    supabase
      .from("organization_team_members")
      .select("team_id", { count: "exact" })
      .in("team_id", teamIds),
    supabase
      .from("client_team_assignments")
      .select("team_id", { count: "exact" })
      .in("team_id", teamIds),
  ]);

  // 上記 は 総 count しか 返さない ため、 team_id 別 の 集計 を 追加 で 引く。
  const memberByTeam = new Map<string, number>();
  const clientByTeam = new Map<string, number>();
  for (const row of (memberCounts.data ?? []) as Array<{ team_id: string }>) {
    memberByTeam.set(row.team_id, (memberByTeam.get(row.team_id) ?? 0) + 1);
  }
  for (const row of (clientCounts.data ?? []) as Array<{ team_id: string }>) {
    clientByTeam.set(row.team_id, (clientByTeam.get(row.team_id) ?? 0) + 1);
  }

  return teams.map((t) => ({
    ...t,
    memberCount: memberByTeam.get(t.id) ?? 0,
    clientCount: clientByTeam.get(t.id) ?? 0,
  }));
}

/**
 * team の member 一覧 (org_members / profiles を join した 表示 用は 呼び 出し 側 で 補う)。
 */
export async function listTeamMembers(teamId: string): Promise<OrganizationTeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_team_members")
    .select("team_id, member_id, role, added_at, added_by_member_id")
    .eq("team_id", teamId);
  return (data ?? []).map((row) => {
    const r = row as {
      team_id: string;
      member_id: string;
      role: "member" | "lead";
      added_at: string;
      added_by_member_id: string | null;
    };
    return {
      teamId: r.team_id,
      memberId: r.member_id,
      role: r.role,
      addedAt: r.added_at,
      addedByMemberId: r.added_by_member_id,
    };
  });
}

/**
 * 顧客 の team assignment 一覧 (顧客 詳細 で 「所属 team」 表示 用)。
 */
export async function listClientTeamAssignments(
  clientRecordId: string,
): Promise<ClientTeamAssignment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_team_assignments")
    .select("client_record_id, team_id, assigned_at, assigned_by_member_id")
    .eq("client_record_id", clientRecordId);
  return (data ?? []).map((row) => {
    const r = row as {
      client_record_id: string;
      team_id: string;
      assigned_at: string;
      assigned_by_member_id: string | null;
    };
    return {
      clientRecordId: r.client_record_id,
      teamId: r.team_id,
      assignedAt: r.assigned_at,
      assignedByMemberId: r.assigned_by_member_id,
    };
  });
}

/**
 * 組織 内 の 全 client_team_assignments (顧客 一覧 側 で team フィルタ に 使う)。
 * RLS で 呼び 出し 者 が 見え る 顧客 の 割当 のみ 返る。
 * 出力: Map<client_record_id, team_id[]>。
 */
export async function listAllClientTeamsMap(
  organizationId: string,
): Promise<Map<string, string[]>> {
  const supabase = await createClient();
  // 組織 の team を 経由 して 割当 を 全 件 取得。 RLS で 自動 絞り 込 み される。
  const { data: teamRows } = await supabase
    .from("organization_teams")
    .select("id")
    .eq("organization_id", organizationId);
  const teamIds = (teamRows ?? []).map((r) => (r as { id: string }).id);
  if (teamIds.length === 0) return new Map();

  const { data: assignmentRows } = await supabase
    .from("client_team_assignments")
    .select("client_record_id, team_id")
    .in("team_id", teamIds);

  const map = new Map<string, string[]>();
  for (const row of (assignmentRows ?? []) as Array<{
    client_record_id: string;
    team_id: string;
  }>) {
    const existing = map.get(row.client_record_id) ?? [];
    existing.push(row.team_id);
    map.set(row.client_record_id, existing);
  }
  return map;
}
