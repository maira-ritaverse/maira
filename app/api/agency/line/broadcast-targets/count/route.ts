import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import {
  resolveBroadcastTargetLineUserIds,
  type BroadcastTargetKind,
} from "@/lib/line/broadcast-targets";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/broadcast-targets/count?kind=all|linked|unlinked&tagIds=uuid,uuid
 *
 * 一斉送信 の 対象 友達 数 を リアルタイム 計算 (UI で 表示)。
 * tagIds は line_conversation_tags.id の カンマ 区切り。 0 件 なら タグ フィルタ なし。
 */
export async function GET(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const kindRaw = url.searchParams.get("kind") ?? "all";
  const kind: BroadcastTargetKind =
    kindRaw === "linked" || kindRaw === "unlinked" ? kindRaw : "all";
  const tagIdsRaw = url.searchParams.get("tagIds") ?? "";
  const tagIds = tagIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const admin = createServiceClient();
  const ids = await resolveBroadcastTargetLineUserIds(admin, {
    organizationId: guard.organization.id,
    target: kind,
    tagIds: tagIds.length > 0 ? tagIds : null,
  });
  return NextResponse.json({ count: ids.length });
}
