import { NextResponse } from "next/server";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { getUserRole } from "@/lib/organizations/queries";
import { listTeamsWithCounts } from "@/lib/teams/queries";
import { createTeamRequestSchema } from "@/lib/teams/types";

/**
 * GET  /api/agency/teams          - 組織 の team 一覧 (member/client 数 付き)
 * POST /api/agency/teams          - admin のみ team 作成
 *
 * 認証 と 権限:
 *   ・GET  : organization_member であれば 誰 でも 一覧 参照 可 (RLS で 同 org 限定)
 *   ・POST : create_team RPC 側 で admin 判定 (二重 防御 で route でも 拒否)
 */

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
  return { ok: true as const, supabase: guard.supabase, user: guard.user, role };
}

export async function GET() {
  const guard = await requireAgencyMember();
  if (!guard.ok) return guard.response;
  const teams = await listTeamsWithCounts(guard.role.organization!.id);
  return NextResponse.json({ teams });
}

export async function POST(request: Request) {
  const guard = await requireAgencyMember();
  if (!guard.ok) return guard.response;
  if (guard.role.member?.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "team 作成 は 組織 admin のみ 可能 です" },
      { status: 403 },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = createTeamRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: newId, error } = await guard.supabase.rpc("create_team", {
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_color: parsed.data.color ?? null,
    p_sort_order: parsed.data.sortOrder ?? 0,
  });
  if (error) {
    if (error.message?.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error.code === "23505" || error.message?.includes("unique")) {
      return NextResponse.json(
        { error: "duplicate_name", message: "同じ 名前 の team が 既に あります" },
        { status: 409 },
      );
    }
    console.error("[teams/create] rpc failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json(
      { error: "unknown", message: "team 作成 に 失敗 しま した" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: newId }, { status: 201 });
}
