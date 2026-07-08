import { NextResponse } from "next/server";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { getUserRole } from "@/lib/organizations/queries";
import { assignClientTeamsRequestSchema } from "@/lib/teams/types";

/**
 * PATCH /api/agency/clients/[id]/teams
 *
 * body: { teamIds: string[] }  - 顧客 に 属する team 全集合 を セット する (差分 更新)。
 *
 * 権限: assign_client_to_team / unassign_client_from_team RPC 側 で
 *   admin / 主担当 / team lead を 判定 する。
 *
 * 差分 実装:
 *   現在 の assignments を SELECT → 差集合 で ADD / REMOVE を それぞれ RPC 呼び 出し。
 *   1 request 内 で N-1 呼び 出し に なる が、 team 数 は 上限 20 なの で 実用 上 問題 なし。
 */
type RouteContext = { params: Promise<{ id: string }> };

async function requireAgencyMember() {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const role = await getUserRole(guard.user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, supabase: guard.supabase };
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

  // 現状 の assignments (RLS で 同 org のみ SELECT 可)
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

  // 逐次 実行 (RPC 上限 に 引っかかる まで の 心配 は 20 件 なので 皆無)。
  // 失敗 時 は 中断 し、 これ まで の 変更 は 残る (transactional でない 点 は 割り切り)。
  for (const teamId of toAdd) {
    const { error } = await g.supabase.rpc("assign_client_to_team", {
      p_client_record_id: clientRecordId,
      p_team_id: teamId,
    });
    if (error) return handleRpcError(error);
  }
  for (const teamId of toRemove) {
    const { error } = await g.supabase.rpc("unassign_client_from_team", {
      p_client_record_id: clientRecordId,
      p_team_id: teamId,
    });
    if (error) return handleRpcError(error);
  }

  return NextResponse.json({ ok: true, added: toAdd.length, removed: toRemove.length });
}

function handleRpcError(error: { code?: string; message?: string }): Response {
  const msg = error.message ?? "";
  if (msg.includes("forbidden")) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "リスト表への割当は管理者・主担当・リーダーのみ可能です",
      },
      { status: 403 },
    );
  }
  if (msg.includes("not_found")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  console.error("[client-teams] rpc failed", { code: error.code, message: msg });
  return NextResponse.json(
    { error: "unknown", message: "リスト表の割当に失敗しました" },
    { status: 500 },
  );
}
