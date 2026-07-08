import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { getUserRole } from "@/lib/organizations/queries";
import { buildOrganizationGraph } from "@/lib/teams/graph";

/**
 * GET /api/agency/admin/org-graph
 *
 * 組織 の ツリー グラフ を 返す (組織 admin のみ)。
 * /agency/admin/overview で 表示 用。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const role = await getUserRole(guard.user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    role.member?.role !== "admin"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const graph = await buildOrganizationGraph(role.organization.id);
  return NextResponse.json({ graph });
}
