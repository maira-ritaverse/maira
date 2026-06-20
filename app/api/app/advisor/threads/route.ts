import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { listThreads } from "@/lib/advisor/queries";

/**
 * GET /api/app/advisor/threads
 *
 * 求職者 自身 の advisor thread 一覧。
 * RLS で seeker_user_id = auth.uid() の 行 だけ 取れる。
 * 一覧 で 相手 (エージェント) の 組織 名 も 併せて 返す。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const threads = await listThreads(guard.supabase);
  if (threads.length === 0) return NextResponse.json({ threads });

  const orgIds = Array.from(new Set(threads.map((t) => t.organizationId)));
  const { data: orgRows } = await guard.supabase
    .from("organizations")
    .select("id, name")
    .in("id", orgIds);
  type OrgRow = { id: string; name: string };
  const nameMap = new Map(((orgRows ?? []) as OrgRow[]).map((o) => [o.id, o.name]));

  return NextResponse.json({
    threads: threads.map((t) => ({
      ...t,
      counterpartDisplayName: nameMap.get(t.organizationId) ?? null,
    })),
  });
}
