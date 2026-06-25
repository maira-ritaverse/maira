/**
 * 管理者 向け 「組織 マネジメント ダッシュボード」 の 集計 クエリ。
 *
 * /agency/management で 使う。 admin のみ アクセス 可能 ( ページ 側 で ガード )。
 *
 * 効率 観点:
 *   ・組織 規模 が 小〜中 ( 数 百 名 まで ) を 前提 に 全 件 fetch して JS 集計
 *   ・大 規模 化 した ら server-side RPC ( SECURITY DEFINER ) に 切り替え 想定
 */
import { createClient } from "@/lib/supabase/server";

const SILENT_THRESHOLD_DAYS = 30;

export type AdvisorSummary = {
  memberId: string;
  displayName: string | null;
  assignedCount: number; // 主 担当 として 持って いる 求職者 数
  collaboratorCount: number; // 副 担当 として 関わって いる 求職者 数
  silentCount: number; // 主 担当 のうち 30 日 沈黙
  overdueTaskCount: number; // 期限 切れ + 未 完了 タスク
};

export type UnassignedClient = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
};

export type ManagementSummary = {
  totalClients: number;
  totalOpenJobs: number;
  unassignedCount: number;
  silentCountTotal: number;
  overdueTaskTotal: number;
  advisors: AdvisorSummary[];
  unassignedClients: UnassignedClient[];
};

export async function getManagementSummary(organizationId: string): Promise<ManagementSummary> {
  const supabase = await createClient();

  const [clientsRes, jobsRes, membersRes, tasksRes, interactionsRes, collaboratorsRes] =
    await Promise.all([
      supabase
        .from("client_records")
        .select("id, name, status, assigned_member_id, created_at")
        .eq("organization_id", organizationId),
      supabase
        .from("job_postings")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("status", "open"),
      supabase.rpc("list_organization_member_display_names", {
        target_organization_id: organizationId,
      }),
      supabase
        .from("agency_tasks")
        .select("id, assigned_member_id, due_at, completed_at, organization_id")
        .eq("organization_id", organizationId)
        .is("completed_at", null),
      supabase
        .from("client_interactions")
        .select("client_record_id, occurred_at")
        .order("occurred_at", { ascending: false }),
      supabase.from("client_record_collaborators").select("client_record_id, member_id"),
    ]);

  type ClientRow = {
    id: string;
    name: string;
    status: string;
    assigned_member_id: string | null;
    created_at: string;
  };
  type JobRow = { id: string };
  type MemberRow = { member_id: string; display_name: string | null };
  type TaskRow = {
    id: string;
    assigned_member_id: string | null;
    due_at: string | null;
    completed_at: string | null;
  };
  type InteractionRow = { client_record_id: string; occurred_at: string };
  type CollaboratorRow = { client_record_id: string; member_id: string };

  const clients = (clientsRes.data ?? []) as ClientRow[];
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const members = (membersRes.data ?? []) as MemberRow[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const interactions = (interactionsRes.data ?? []) as InteractionRow[];
  const collaborators = (collaboratorsRes.data ?? []) as CollaboratorRow[];

  // 最終 接点 日時 ( 沈黙 判定 用 )。 fallback は created_at
  const lastContactByClient = new Map<string, string>();
  for (const it of interactions) {
    if (!lastContactByClient.has(it.client_record_id)) {
      lastContactByClient.set(it.client_record_id, it.occurred_at);
    }
  }

  const now = Date.now();
  const SILENT_MS = SILENT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const isSilent = (clientId: string, createdAt: string): boolean => {
    const last = lastContactByClient.get(clientId) ?? createdAt;
    return now - new Date(last).getTime() >= SILENT_MS;
  };

  const isOverdue = (dueAt: string | null): boolean => {
    if (!dueAt) return false;
    return new Date(dueAt).getTime() < now;
  };

  // 担当 別 集計
  const advisors: AdvisorSummary[] = members.map((m) => {
    const assigned = clients.filter((c) => c.assigned_member_id === m.member_id);
    const collabIds = new Set(
      collaborators.filter((c) => c.member_id === m.member_id).map((c) => c.client_record_id),
    );
    const silentCount = assigned.filter((c) => isSilent(c.id, c.created_at)).length;
    const overdueTaskCount = tasks.filter(
      (t) => t.assigned_member_id === m.member_id && isOverdue(t.due_at),
    ).length;

    return {
      memberId: m.member_id,
      displayName: m.display_name,
      assignedCount: assigned.length,
      collaboratorCount: collabIds.size,
      silentCount,
      overdueTaskCount,
    };
  });

  // 担当 数 が 多い 順 で 並べ替え
  advisors.sort((a, b) => b.assignedCount - a.assignedCount);

  // 未 割り当て クライアント ( 新しい もの から )
  const unassignedRaw = clients
    .filter((c) => !c.assigned_member_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // 沈黙 ( 組織 全 体 )
  const silentCountTotal = clients.filter((c) => isSilent(c.id, c.created_at)).length;

  // 期限 切れ タスク ( 組織 全 体 )
  const overdueTaskTotal = tasks.filter((t) => isOverdue(t.due_at)).length;

  return {
    totalClients: clients.length,
    totalOpenJobs: jobs.length,
    unassignedCount: unassignedRaw.length,
    silentCountTotal,
    overdueTaskTotal,
    advisors,
    unassignedClients: unassignedRaw.slice(0, 20).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      createdAt: c.created_at,
    })),
  };
}
