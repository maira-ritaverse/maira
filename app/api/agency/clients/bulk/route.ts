import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { logClientChanges } from "@/lib/audit/client-audit-log";
import { clientStatusLabels } from "@/lib/clients/types";

/**
 * POST /api/agency/clients/bulk
 *
 * 顧客一覧で複数選択された ID 群に対する一括操作。
 *   - set_status: ステータスを一括変更
 *   - set_assignee: 担当者を一括変更(null は担当解除)
 *   - add_tags / remove_tags: CRM タグの追加 / 削除(配列のマージ / 差分)
 *
 * 認可:
 *   - organization_member ガード
 *   - WHERE 句で organization_id 一致を強制(RLS と二重防御)
 *
 * 制限:
 *   - ids は 200 件まで(誤コピペの暴発防止)
 *   - tags は 1 操作で 20 件まで
 *
 * 監査:
 *   - 変更後に client_audit_log へ追記。失敗は警告のみ。
 *
 * 戻り値:
 *   - { updated: number, ids: string[] }
 */

const MAX_IDS = 200;
const MAX_TAGS = 20;

const baseSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_IDS),
});

const setStatusSchema = baseSchema.extend({
  action: z.literal("set_status"),
  status: z.enum([
    "initial_meeting",
    "job_matching",
    "in_screening",
    "offer",
    "completed",
    "declined",
  ]),
});

const setAssigneeSchema = baseSchema.extend({
  action: z.literal("set_assignee"),
  assignedMemberId: z.string().uuid().nullable(),
});

const addTagsSchema = baseSchema.extend({
  action: z.literal("add_tags"),
  tags: z.array(z.string().min(1).max(50)).min(1).max(MAX_TAGS),
});

const removeTagsSchema = baseSchema.extend({
  action: z.literal("remove_tags"),
  tags: z.array(z.string().min(1).max(50)).min(1).max(MAX_TAGS),
});

const MAX_TEAMS = 20;
const addTeamsSchema = baseSchema.extend({
  action: z.literal("add_teams"),
  teamIds: z.array(z.string().uuid()).min(1).max(MAX_TEAMS),
});
const removeTeamsSchema = baseSchema.extend({
  action: z.literal("remove_teams"),
  teamIds: z.array(z.string().uuid()).min(1).max(MAX_TEAMS),
});

const requestSchema = z.discriminatedUnion("action", [
  setStatusSchema,
  setAssigneeSchema,
  addTagsSchema,
  removeTagsSchema,
  addTeamsSchema,
  removeTeamsSchema,
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { ids } = parsed.data;
  const organizationId = role.organization.id;

  // 担当者変更の場合:assigned_member_id が自組織のメンバーか先に検証する
  // (他組織の member id を割り当てるとデータ整合性が崩れる)
  if (parsed.data.action === "set_assignee" && parsed.data.assignedMemberId) {
    const { data: memberRow } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("id", parsed.data.assignedMemberId)
      // soft delete された メンバー は 担当 に 割り当て 不可
      .is("removed_at", null)
      .maybeSingle();
    if (!memberRow || memberRow.organization_id !== organizationId) {
      return NextResponse.json(
        { error: "Assignee not found in your organization" },
        { status: 404 },
      );
    }
  }

  // 一括 UPDATE のためには、既存値(監査ログ用)を取得する。
  // 取得カラムは action 種類で必要なものに絞る。
  // 動的な select 文字列は Supabase 型推論で表現できないため、unknown 経由で受け取る。
  const selectCols = pickSelectColumns(parsed.data.action);
  const selectExpr = selectCols.length === 0 ? "id" : `id, ${selectCols.join(",")}`;
  const { data: oldRowsData, error: oldErr } = await supabase
    .from("client_records")
    .select(selectExpr)
    .in("id", ids)
    .eq("organization_id", organizationId);
  if (oldErr || !oldRowsData) {
    return NextResponse.json(
      { error: "Failed to load records", message: oldErr?.message ?? "Unknown" },
      { status: 500 },
    );
  }
  const oldRows = oldRowsData as unknown as Array<Record<string, unknown>>;
  // 他組織の ID を混ぜて送られた場合は ここで除外される(SELECT が返さない)
  const targetIds = oldRows.map((r) => r.id as string);
  if (targetIds.length === 0) {
    return NextResponse.json({ updated: 0, ids: [] });
  }

  // action ごとの更新本体
  const auditChanges: Array<{
    clientRecordId: string;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
  }> = [];

  if (parsed.data.action === "set_status") {
    const newValue = parsed.data.status;
    const { error } = await supabase
      .from("client_records")
      .update({ status: newValue })
      .in("id", targetIds)
      .eq("organization_id", organizationId);
    if (error)
      return NextResponse.json({ error: "Failed", message: error.message }, { status: 500 });

    for (const r of oldRows) {
      const prevStatus = r.status as string | null;
      if (prevStatus !== newValue) {
        auditChanges.push({
          clientRecordId: r.id as string,
          fieldName: "status",
          oldValue: prevStatus,
          newValue,
        });
      }
    }
  } else if (parsed.data.action === "set_assignee") {
    const newValue = parsed.data.assignedMemberId;
    const { error } = await supabase
      .from("client_records")
      .update({ assigned_member_id: newValue })
      .in("id", targetIds)
      .eq("organization_id", organizationId);
    if (error)
      return NextResponse.json({ error: "Failed", message: error.message }, { status: 500 });

    for (const r of oldRows) {
      const prev = (r.assigned_member_id as string | null) ?? null;
      if (prev !== newValue) {
        auditChanges.push({
          clientRecordId: r.id as string,
          fieldName: "assigned_member_id",
          oldValue: prev,
          newValue,
        });
      }
    }
  } else if (parsed.data.action === "add_teams" || parsed.data.action === "remove_teams") {
    // 一括割当は単一 PL/pgSQL RPC (assign_clients_to_teams_bulk /
    // unassign_clients_from_teams_bulk) を呼ぶ。 単一トランザクション内で
    // 全ペアの権限判定 + INSERT/DELETE を実行し、結果を行単位で返す。
    // N×M 逐次 RPC 呼び出しを 1 呼び出しに集約。
    const isAdd = parsed.data.action === "add_teams";
    const rpcName = isAdd ? "assign_clients_to_teams_bulk" : "unassign_clients_from_teams_bulk";

    // 事前 teamIds org 検証は変わらず (RPC 内でも判定するが、早期に 400 を返す)。
    const { data: orgTeamRows } = await supabase
      .from("organization_teams")
      .select("id")
      .in("id", parsed.data.teamIds)
      .eq("organization_id", organizationId);
    const validTeamIds = new Set(((orgTeamRows ?? []) as Array<{ id: string }>).map((r) => r.id));
    const invalidTeamIds = parsed.data.teamIds.filter((id) => !validTeamIds.has(id));
    if (invalidTeamIds.length > 0) {
      return NextResponse.json(
        {
          error: "teams_not_in_org",
          message: "指定されたリスト表の一部が組織内に存在しません",
          invalid_team_ids: invalidTeamIds,
        },
        { status: 400 },
      );
    }

    const { data: rpcRows, error: rpcError } = await supabase.rpc(rpcName, {
      p_client_ids: targetIds,
      p_team_ids: parsed.data.teamIds,
    });
    if (rpcError) {
      // input_size / unauthenticated / forbidden (org 判定) 等の初期段階エラー。
      if (rpcError.code === "42501" || rpcError.message?.includes("forbidden")) {
        return NextResponse.json(
          {
            error: "forbidden",
            message: "リスト表への一括操作の権限がありません",
          },
          { status: 403 },
        );
      }
      // 500 の場合、フロント側で診断できるよう message に生の DB エラーを乗せる
      // (内部設定情報の漏洩リスクは低い / admin 操作なので OK)。 sanitize は
      // 最大 300 字にとどめる。
      console.error("[bulk teams] rpc failed", {
        code: rpcError.code,
        message: rpcError.message,
        details: rpcError.details,
        hint: rpcError.hint,
      });
      return NextResponse.json(
        {
          error: "unknown",
          message: `リスト表の一括更新に失敗しました: ${(rpcError.message ?? "").slice(0, 300)}`,
          code: rpcError.code ?? null,
          hint: (rpcError.hint ?? "").slice(0, 200) || undefined,
        },
        { status: 500 },
      );
    }

    type BulkRow = {
      client_record_id: string;
      team_id: string;
      operation: string;
      applied: boolean;
      reason: string;
    };
    const rows = (rpcRows ?? []) as BulkRow[];
    const successClientIds = new Set<string>();
    const failedByClient = new Map<string, { forbidden: number; other: number }>();
    for (const row of rows) {
      if (row.reason === "ok") {
        successClientIds.add(row.client_record_id);
        if (row.applied) {
          auditChanges.push({
            clientRecordId: row.client_record_id,
            fieldName: row.operation === "add" ? "team_added" : "team_removed",
            oldValue: null,
            newValue: row.team_id,
          });
        }
      } else {
        const bucket = failedByClient.get(row.client_record_id) ?? { forbidden: 0, other: 0 };
        if (row.reason === "forbidden") bucket.forbidden += 1;
        else bucket.other += 1;
        failedByClient.set(row.client_record_id, bucket);
      }
    }

    if (successClientIds.size === 0 && failedByClient.size > 0) {
      const totalForbidden = [...failedByClient.values()].reduce((s, b) => s + b.forbidden, 0);
      const totalOther = [...failedByClient.values()].reduce((s, b) => s + b.other, 0);
      return NextResponse.json(
        {
          error: totalForbidden > 0 ? "forbidden" : "failed",
          message:
            totalForbidden > 0
              ? "リスト表への割当権限がありません(管理者/主担当/リーダーのみ可能)"
              : "リスト表の一括更新に失敗しました",
          forbidden_count: totalForbidden,
          error_count: totalOther,
        },
        { status: totalForbidden > 0 ? 403 : 500 },
      );
    }

    const failedClientIds = [...failedByClient.keys()];
    const partialFailure = failedClientIds.length > 0;
    return NextResponse.json({
      updated: successClientIds.size,
      ids: [...successClientIds],
      partial_failure: partialFailure,
      failed_client_ids: failedClientIds,
      forbidden_count: [...failedByClient.values()].reduce((s, b) => s + b.forbidden, 0),
      error_count: [...failedByClient.values()].reduce((s, b) => s + b.other, 0),
    });
  } else if (parsed.data.action === "add_tags" || parsed.data.action === "remove_tags") {
    // タグは行ごとに集合演算が必要なので 1 件ずつ UPDATE する。
    // 行数上限が 200 なので往復は許容範囲。
    const newTagsToAdd = parsed.data.action === "add_tags" ? parsed.data.tags : [];
    const newTagsToRemove = parsed.data.action === "remove_tags" ? parsed.data.tags : [];

    for (const r of oldRows) {
      const rid = r.id as string;
      const current = (r.crm_tags as string[] | null) ?? [];
      let next: string[];
      if (parsed.data.action === "add_tags") {
        const set = new Set(current);
        for (const t of newTagsToAdd) set.add(t);
        next = Array.from(set);
      } else {
        const removeSet = new Set(newTagsToRemove);
        next = current.filter((t) => !removeSet.has(t));
      }
      // 変化が無ければスキップ
      if (sameArray(current, next)) continue;

      const { error } = await supabase
        .from("client_records")
        .update({ crm_tags: next })
        .eq("id", rid)
        .eq("organization_id", organizationId);
      if (error) {
        // 1 件ごとの失敗は他の処理を止めず警告
        console.warn(`[bulk tags] update failed for ${rid}:`, error.message);
        continue;
      }

      auditChanges.push({
        clientRecordId: rid,
        fieldName: "crm_tags",
        oldValue: current.length === 0 ? null : current.join(", "),
        newValue: next.length === 0 ? null : next.join(", "),
      });
    }
  }

  // 監査ログ。1 record × 1 field の単位で書く(client-audit-log の logClientChanges
  // は同一 record 内の複数 field 変更をまとめる契約なので、record ごとに呼ぶ)。
  const byClient = new Map<string, typeof auditChanges>();
  for (const c of auditChanges) {
    const arr = byClient.get(c.clientRecordId) ?? [];
    arr.push(c);
    byClient.set(c.clientRecordId, arr);
  }
  for (const [clientId, changes] of byClient.entries()) {
    await logClientChanges(
      { organizationId, clientRecordId: clientId, actorMemberId: role.member.id },
      changes.map((c) => ({
        fieldName: c.fieldName,
        oldValue: c.oldValue,
        newValue: c.newValue,
      })),
    );
  }

  // 補助:status の場合は人間可読ラベルも返すと UX 良いが、いまは件数のみ。
  void clientStatusLabels;

  return NextResponse.json({ updated: targetIds.length, ids: targetIds });
}

/** UPDATE 前に取得する列を action 別に決める。 */
function pickSelectColumns(
  action: "set_status" | "set_assignee" | "add_tags" | "remove_tags" | "add_teams" | "remove_teams",
): string[] {
  switch (action) {
    case "set_status":
      return ["status"];
    case "set_assignee":
      return ["assigned_member_id"];
    case "add_tags":
    case "remove_tags":
      return ["crm_tags"];
    case "add_teams":
    case "remove_teams":
      // リスト表 割 当 は client_records 自体 の 列 変更 では ない ため 「id」 だけ 引く。
      return [];
  }
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}
