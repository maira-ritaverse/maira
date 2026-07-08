import { NextResponse } from "next/server";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { getUserRole } from "@/lib/organizations/queries";
import { updateTeamRequestSchema } from "@/lib/teams/types";

/**
 * PATCH  /api/agency/teams/[id]   - admin のみ、 name/description/color/sort_order 更新
 * DELETE /api/agency/teams/[id]   - admin のみ、 cascade で assignments 消える
 */
type RouteContext = { params: Promise<{ id: string }> };

async function guardAdmin() {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const role = await getUserRole(guard.user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  if (role.member?.role !== "admin") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, supabase: guard.supabase };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const g = await guardAdmin();
  if (!g.ok) return g.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = updateTeamRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error } = await g.supabase.rpc("update_team", {
    p_team_id: id,
    p_name: parsed.data.name ?? null,
    p_description: parsed.data.description ?? null,
    p_color: parsed.data.color ?? null,
    p_sort_order: parsed.data.sortOrder ?? null,
  });
  if (error) {
    if (error.message?.includes("not_found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (error.message?.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "duplicate_name", message: "同じ 名前 の team が 既に あります" },
        { status: 409 },
      );
    }
    console.error("[teams/update] rpc failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const g = await guardAdmin();
  if (!g.ok) return g.response;

  const { error } = await g.supabase.rpc("delete_team", { p_team_id: id });
  if (error) {
    if (error.message?.includes("not_found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (error.message?.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    console.error("[teams/delete] rpc failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
