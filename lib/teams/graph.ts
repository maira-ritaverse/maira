/**
 * 組織 グラフ (ツリー) の 構築 ロジック。
 *
 * /agency/admin/overview で 表示 する ツリー ビュー の データ ソース。
 *   [組織]
 *     ├─ [team A] — members: N / clients: M
 *     │   ├─ member (lead) name
 *     │   └─ member (member) name
 *     ├─ [team B]
 *     └─ [未 割当 pool] — clients: X
 *
 * ノード 数 が 増える と 大 きく なる ため、 UI 側 で 遅延 展開 する 想定。
 * ここ は 集計 + 単純 な 木 構造 を 返す だけ。
 */
import { createClient } from "@/lib/supabase/server";

export type OrgGraphNode =
  | {
      kind: "organization";
      id: string;
      name: string;
      totalMembers: number;
      totalClients: number;
      children: OrgGraphNode[];
    }
  | {
      kind: "team";
      id: string;
      name: string;
      color: string | null;
      memberCount: number;
      clientCount: number;
      children: OrgGraphNode[];
    }
  | {
      kind: "unassigned_pool";
      id: "__unassigned__";
      clientCount: number;
    }
  | {
      kind: "member";
      id: string;
      displayName: string;
      role: "admin" | "advisor";
      teamRole: "member" | "lead" | null;
      assignedClientCount: number;
    };

export type OrgGraph = OrgGraphNode & { kind: "organization" };

/**
 * 組織 全体 の ツリー を 構築 する。 admin が 呼ぶ 前提。
 * 集計 は org 内 の 全 データ に 対して 行う ため、 大 組織 だと 数百 ms 級 の 時間 が
 * かかる 可能性 あり。 UI 側 で 遅延 展開 や TanStack Query に よる キャッシュ を 検討。
 */
export async function buildOrganizationGraph(organizationId: string): Promise<OrgGraph> {
  const supabase = await createClient();

  const [orgRes, teamsRes, membersRes, teamMembersRes, clientCountRes, assignmentsRes] =
    await Promise.all([
      supabase.from("organizations").select("id, name").eq("id", organizationId).maybeSingle(),
      supabase
        .from("organization_teams")
        .select("id, name, color, sort_order")
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.rpc("list_organization_members_with_meta", {
        target_organization_id: organizationId,
      }),
      supabase.from("organization_team_members").select("team_id, member_id, role"),
      supabase
        .from("client_records")
        .select("id, assigned_member_id", { count: "exact" })
        .eq("organization_id", organizationId),
      supabase.from("client_team_assignments").select("client_record_id, team_id"),
    ]);

  const orgName = (orgRes.data as { id: string; name: string } | null)?.name ?? "(不明 な 組織)";
  const teams =
    (teamsRes.data as Array<{
      id: string;
      name: string;
      color: string | null;
      sort_order: number;
    }> | null) ?? [];
  const members =
    (membersRes.data as Array<{
      member_id: string;
      user_id: string;
      role: string;
      display_name: string | null;
      email: string | null;
    }> | null) ?? [];
  const teamMemberRows =
    (teamMembersRes.data as Array<{
      team_id: string;
      member_id: string;
      role: "member" | "lead";
    }> | null) ?? [];
  const clientRows =
    (clientCountRes.data as Array<{
      id: string;
      assigned_member_id: string | null;
    }> | null) ?? [];
  const assignments =
    (assignmentsRes.data as Array<{ client_record_id: string; team_id: string }> | null) ?? [];

  // team → members
  const teamMembersMap = new Map<string, Array<{ memberId: string; role: "member" | "lead" }>>();
  for (const row of teamMemberRows) {
    const arr = teamMembersMap.get(row.team_id) ?? [];
    arr.push({ memberId: row.member_id, role: row.role });
    teamMembersMap.set(row.team_id, arr);
  }

  // team → clientIds
  const teamClientMap = new Map<string, Set<string>>();
  const assignedClientIds = new Set<string>();
  for (const row of assignments) {
    assignedClientIds.add(row.client_record_id);
    const s = teamClientMap.get(row.team_id) ?? new Set<string>();
    s.add(row.client_record_id);
    teamClientMap.set(row.team_id, s);
  }

  // 主 担当 別 の 顧客 数 (member ノード の 集計)
  const clientsByAssignee = new Map<string, number>();
  for (const c of clientRows) {
    if (!c.assigned_member_id) continue;
    clientsByAssignee.set(
      c.assigned_member_id,
      (clientsByAssignee.get(c.assigned_member_id) ?? 0) + 1,
    );
  }

  const memberMap = new Map<string, { displayName: string; role: "admin" | "advisor" }>();
  for (const m of members) {
    memberMap.set(m.member_id, {
      displayName: m.display_name ?? m.email ?? "(名前 未設定)",
      role: m.role === "admin" ? "admin" : "advisor",
    });
  }

  const totalClients = clientRows.length;
  const unassignedCount = totalClients - assignedClientIds.size;

  const teamNodes: OrgGraphNode[] = teams.map((t) => {
    const teamMembers = teamMembersMap.get(t.id) ?? [];
    const clientCount = (teamClientMap.get(t.id) ?? new Set()).size;
    const memberNodes: OrgGraphNode[] = teamMembers.map((tm) => {
      const info = memberMap.get(tm.memberId);
      return {
        kind: "member" as const,
        id: tm.memberId,
        displayName: info?.displayName ?? "(削除 済 メンバー)",
        role: info?.role ?? "advisor",
        teamRole: tm.role,
        assignedClientCount: clientsByAssignee.get(tm.memberId) ?? 0,
      };
    });
    return {
      kind: "team" as const,
      id: t.id,
      name: t.name,
      color: t.color,
      memberCount: teamMembers.length,
      clientCount,
      children: memberNodes,
    };
  });

  // 未 割当 pool を team と 同じ 高 さ に 差し込む
  const rootChildren: OrgGraphNode[] = [
    ...teamNodes,
    {
      kind: "unassigned_pool" as const,
      id: "__unassigned__" as const,
      clientCount: unassignedCount,
    },
  ];

  return {
    kind: "organization",
    id: organizationId,
    name: orgName,
    totalMembers: members.length,
    totalClients,
    children: rootChildren,
  };
}
