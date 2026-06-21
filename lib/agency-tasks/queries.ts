/**
 * エージェント業務タスク(agency_tasks)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業のタスクのみが返る。
 * client_records / referrals / interactions と同じ構造で揃えている。
 *
 * 担当者の表示名は list_organization_member_display_names(SECURITY DEFINER)で
 * Map を作って合流する(profiles の RLS を緩めずに済ませるため)。
 */

import { getOrgMemberAvatarMaps } from "@/lib/agency/member-avatars";
import { createClient } from "@/lib/supabase/server";

import type {
  AgencyTask,
  AgencyTaskPriority,
  AgencyTaskStatus,
  AgencyTaskWithAssignee,
} from "./types";

type AgencyTaskRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  referral_id: string | null;
  assigned_member_id: string;
  title: string;
  status: string;
  priority: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToTask(row: AgencyTaskRow): AgencyTask {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    referralId: row.referral_id,
    assignedMemberId: row.assigned_member_id,
    title: row.title,
    status: row.status as AgencyTaskStatus,
    priority: (row.priority as AgencyTaskPriority | null) ?? null,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 「未完了 → 期限が近い順(期限なしは末尾)」「完了 → 完了が新しい順」で並べる。
 *
 * DB側の order だけだと「null を末尾に」「status で2グループに分ける」が
 * 1クエリで素直に書けないため、取得後に JS でソートする。
 * 1クライアント分のタスクは多くて数十件想定なのでコスト無視できる。
 */
function sortTasks(tasks: AgencyTask[]): AgencyTask[] {
  return [...tasks].sort((a, b) => {
    // 1. 未完了が先
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;

    // 2. 未完了同士:期限が近い順、期限なしは末尾
    if (a.status === "pending") {
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      // 両方期限なしなら作成が新しい順
      return b.createdAt.localeCompare(a.createdAt);
    }

    // 3. 完了同士:完了が新しい順
    const ac = a.completedAt ?? a.updatedAt;
    const bc = b.completedAt ?? b.updatedAt;
    return bc.localeCompare(ac);
  });
}

/**
 * あるクライアントのタスク一覧(担当者表示名を含む)
 *
 * 並び順は sortTasks の通り。
 */
export async function listTasksByClient(
  clientRecordId: string,
  organizationId: string,
): Promise<AgencyTaskWithAssignee[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agency_tasks")
    .select("*")
    .eq("client_record_id", clientRecordId);

  if (error || !data) return [];

  const tasks = sortTasks((data as AgencyTaskRow[]).map(rowToTask));

  // 担当者の表示名 / avatar URL Map を 並列 取得 (RLS バイパス関数経由)
  const [{ data: memberRows, error: memberError }, avatarMaps] = await Promise.all([
    supabase.rpc("list_organization_member_display_names", {
      target_organization_id: organizationId,
    }),
    getOrgMemberAvatarMaps(supabase, organizationId),
  ]);

  const nameByMemberId = new Map<string, string | null>();
  if (!memberError && memberRows) {
    for (const row of memberRows as Array<{ member_id: string; display_name: string | null }>) {
      nameByMemberId.set(row.member_id, row.display_name);
    }
  }

  return tasks.map((t) => ({
    ...t,
    assigneeName: nameByMemberId.get(t.assignedMemberId) ?? null,
    assigneeAvatarUrl: avatarMaps.byMemberId.get(t.assignedMemberId) ?? null,
  }));
}

/**
 * 組織のメンバー一覧(担当者選択 select の選択肢用)
 *
 * 既存の list_organization_member_display_names は RLS をバイパスしつつ、
 * 呼び出し元が同 organization のメンバーである場合のみ返るため安全。
 */
export async function listOrganizationMembers(
  organizationId: string,
): Promise<Array<{ memberId: string; displayName: string | null }>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_organization_member_display_names", {
    target_organization_id: organizationId,
  });

  if (error || !data) return [];

  return (data as Array<{ member_id: string; display_name: string | null }>).map((row) => ({
    memberId: row.member_id,
    displayName: row.display_name,
  }));
}
