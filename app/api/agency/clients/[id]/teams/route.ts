import { NextResponse } from "next/server";

import type { AuthedUserContext } from "@/lib/api/auth-guards";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";
import { getUserRole } from "@/lib/organizations/queries";
import { assignClientTeamsRequestSchema } from "@/lib/teams/types";

/**
 * PATCH /api/agency/clients/[id]/teams
 *
 * body: { teamIds: string[] } - 顧客に属するリスト表の全集合をセットする(差分更新)。
 *
 * 権限: assign_client_to_team / unassign_client_from_team RPC 側で
 *   admin / 主担当 / リーダー を判定する。
 *
 * 実装方針:
 *   1. clientRecordId が呼び出し者の組織に属するかを service_role で事前検証
 *      (RLS を通す前の情報漏洩防止)
 *   2. teamIds も同じ組織に属するかを事前検証(部分適用後の権限エラーで
 *      中途半端な状態が残るのを防ぐ)
 *   3. 現状の assignments を SELECT → 差集合で ADD / REMOVE を計算
 *   4. すべての RPC を最後まで実行し、成功 / 失敗を集計して返す
 *      (途中中断せず、部分適用が発生した場合も呼び出し元に伝える)
 */
type RouteContext = { params: Promise<{ id: string }> };

type Guard =
  | { ok: true; supabase: AuthedUserContext["supabase"]; organizationId: string }
  | { ok: false; response: Response };

async function requireAgencyMember(): Promise<Guard> {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const role = await getUserRole(guard.user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, supabase: guard.supabase, organizationId: role.organization.id };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id: clientRecordId } = await params;
  const g = await requireAgencyMember();
  if (!g.ok) return g.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = assignClientTeamsRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // clientRecordId が呼び出し者の組織に属するかを service_role で確認する。
  // service_role を使うのは、RLS が team scope で「別 org の顧客が SELECT で 0 行になる」ため、
  // route レベルで「not_found」を明示的に返して 挙動を統一するため。
  const service = createServiceClient();
  const { data: clientRow } = await service
    .from("client_records")
    .select("organization_id")
    .eq("id", clientRecordId)
    .maybeSingle();
  if (!clientRow) {
    return NextResponse.json(
      { error: "not_found", message: "顧客が見つかりません" },
      { status: 404 },
    );
  }
  if ((clientRow as { organization_id: string }).organization_id !== g.organizationId) {
    // クロス組織の情報漏洩を防ぐため 404 で応答 (403 だと存在情報が漏れる)
    return NextResponse.json(
      { error: "not_found", message: "顧客が見つかりません" },
      { status: 404 },
    );
  }

  // teamIds が全て同じ組織のリスト表かを事前検証。
  // 別 org の team_id が混ざっている場合は 400 で拒否 (RPC の not_found で
  // 中断されると差分適用済の状態が残るため事前に弾く)。
  if (parsed.data.teamIds.length > 0) {
    const { data: teamRows } = await service
      .from("organization_teams")
      .select("id")
      .in("id", parsed.data.teamIds)
      .eq("organization_id", g.organizationId);
    const validTeamIds = new Set(((teamRows ?? []) as Array<{ id: string }>).map((r) => r.id));
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
  }

  // 現状の assignments (RLS で 同 org のみ SELECT 可)
  const { data: currentRows, error: fetchErr } = await g.supabase
    .from("client_team_assignments")
    .select("team_id")
    .eq("client_record_id", clientRecordId);
  if (fetchErr) {
    console.error("[client-teams] fetch current failed", { message: fetchErr.message });
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }

  const currentIds = new Set((currentRows ?? []).map((r) => (r as { team_id: string }).team_id));
  const targetIds = new Set(parsed.data.teamIds);

  const toAdd = [...targetIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !targetIds.has(id));

  // 一括 RPC で add / remove を それぞれ 1 呼び出しに集約 (単一トランザクション)。
  // 途中失敗による中途半端な状態を防ぐ。
  type BulkRow = {
    client_record_id: string;
    team_id: string;
    operation: string;
    applied: boolean;
    reason: string;
  };
  const addedTeamIds: string[] = [];
  const removedTeamIds: string[] = [];
  const failures: Array<{ teamId: string; op: "add" | "remove"; reason: string }> = [];

  if (toAdd.length > 0) {
    const { data, error } = await g.supabase.rpc("assign_clients_to_teams_bulk", {
      p_client_ids: [clientRecordId],
      p_team_ids: toAdd,
    });
    if (error) {
      console.error("[client-teams] assign bulk rpc failed", {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json({ error: "unknown" }, { status: 500 });
    }
    for (const row of (data ?? []) as BulkRow[]) {
      if (row.reason === "ok") addedTeamIds.push(row.team_id);
      else failures.push({ teamId: row.team_id, op: "add", reason: row.reason });
    }
  }

  if (toRemove.length > 0) {
    const { data, error } = await g.supabase.rpc("unassign_clients_from_teams_bulk", {
      p_client_ids: [clientRecordId],
      p_team_ids: toRemove,
    });
    if (error) {
      console.error("[client-teams] unassign bulk rpc failed", {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json({ error: "unknown" }, { status: 500 });
    }
    for (const row of (data ?? []) as BulkRow[]) {
      if (row.reason === "ok") removedTeamIds.push(row.team_id);
      else failures.push({ teamId: row.team_id, op: "remove", reason: row.reason });
    }
  }

  const partial = failures.length > 0 && addedTeamIds.length + removedTeamIds.length > 0;
  const allFailed = failures.length > 0 && addedTeamIds.length === 0 && removedTeamIds.length === 0;

  if (allFailed) {
    const forbidden = failures.some((f) => f.reason === "forbidden");
    return NextResponse.json(
      {
        error: forbidden ? "forbidden" : "failed",
        message: forbidden
          ? "リスト表への割当は管理者・主担当・リーダーのみ可能です"
          : "リスト表の割当に失敗しました",
        failures,
      },
      { status: forbidden ? 403 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    added: addedTeamIds.length,
    removed: removedTeamIds.length,
    partial_failure: partial,
    failures,
  });
}
