import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { getUserRole } from "@/lib/organizations/queries";
import { setTeamMemberRequestSchema } from "@/lib/teams/types";

/**
 * POST   /api/agency/teams/[id]/members         - admin のみ、 member 追加 or role 変更
 * DELETE /api/agency/teams/[id]/members?memberId - admin のみ、 member 除外
 */
type RouteContext = { params: Promise<{ id: string }> };

async function guardAdmin() {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const role = await getUserRole(guard.user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    role.member?.role !== "admin"
  ) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, supabase: guard.supabase };
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: teamId } = await params;
  const g = await guardAdmin();
  if (!g.ok) return g.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = setTeamMemberRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error } = await g.supabase.rpc("set_team_member", {
    p_team_id: teamId,
    p_member_id: parsed.data.memberId,
    p_role: parsed.data.role,
  });
  if (error) {
    if (error.message?.includes("not_found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (error.message?.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error.message?.includes("member_not_in_org")) {
      return NextResponse.json(
        { error: "member_not_in_org", message: "組織に存在しないメンバーです" },
        { status: 400 },
      );
    }
    console.error("[team-members/set] rpc failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id: teamId } = await params;
  const g = await guardAdmin();
  if (!g.ok) return g.response;

  const memberIdRaw = new URL(request.url).searchParams.get("memberId");
  if (!memberIdRaw) {
    return NextResponse.json({ error: "missing_member_id" }, { status: 400 });
  }
  // クエリパラメータは string なので UUID 形式を明示的に検証する
  // (不正 UUID がそのまま RPC に流れると 500 になり原因が分かりにくい)。
  const memberIdParsed = z.string().uuid().safeParse(memberIdRaw);
  if (!memberIdParsed.success) {
    return NextResponse.json({ error: "invalid_member_id" }, { status: 400 });
  }
  const memberId = memberIdParsed.data;

  const { error } = await g.supabase.rpc("remove_team_member", {
    p_team_id: teamId,
    p_member_id: memberId,
  });
  if (error) {
    if (error.message?.includes("not_found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (error.message?.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    console.error("[team-members/delete] rpc failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
