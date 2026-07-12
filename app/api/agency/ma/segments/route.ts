/**
 * /api/agency/ma/segments
 *
 * GET   :自組織 の セグメント 一覧
 * POST  :セグメント 新規 作成 (admin) + friend_count_cache 初回 計算
 * PATCH :セグメント 更新 (admin、 body に { id, name?, description?, filter_dsl_json? })
 *        filter_dsl_json 変更 時 は friend_count_cache も 再計算 する。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { countFriendsBySegmentFilter, listSegmentsForOrg } from "@/lib/ma/segment-queries";
import { SegmentFilterSchema, type SegmentFilter } from "@/lib/ma/segment-dsl";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// ────────────────────────────────────────
// GET
// ────────────────────────────────────────
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  try {
    const segments = await listSegmentsForOrg(guard.supabase, guard.organization.id);
    return NextResponse.json({ segments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "fetch_failed", message: msg }, { status: 500 });
  }
}

// ────────────────────────────────────────
// POST (作成)
// ────────────────────────────────────────
const postBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  filter_dsl_json: SegmentFilterSchema,
});

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const filter = parsed.data.filter_dsl_json as SegmentFilter;

  // 事前 に count を 取って cache に 入れる (保存 直後 の 一覧 で N 人 表示)
  let cachedCount: number | null = null;
  try {
    cachedCount = await countFriendsBySegmentFilter(admin, guard.organization.id, filter);
  } catch {
    // count 失敗 は 致命 で ない (後 で cron が 更新)
  }

  const { data, error } = await admin
    .from("line_segments")
    .insert({
      organization_id: guard.organization.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      filter_dsl_json: filter,
      friend_count_cache: cachedCount,
      last_computed_at: cachedCount != null ? new Date().toISOString() : null,
      created_by: guard.user.id,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, friend_count_cache: cachedCount });
}

// ────────────────────────────────────────
// PATCH (更新)
// ────────────────────────────────────────
const patchBody = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  filter_dsl_json: SegmentFilterSchema.optional(),
});

export async function PATCH(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // 自組織 確認
  const { data: existing } = await admin
    .from("line_segments")
    .select("id, organization_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!existing || existing.organization_id !== guard.organization.id) {
    return NextResponse.json({ error: "segment_not_found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;

  if (parsed.data.filter_dsl_json) {
    patch.filter_dsl_json = parsed.data.filter_dsl_json;
    // filter 変更 時 は cache も 更新
    try {
      const count = await countFriendsBySegmentFilter(
        admin,
        guard.organization.id,
        parsed.data.filter_dsl_json as SegmentFilter,
      );
      patch.friend_count_cache = count;
      patch.last_computed_at = new Date().toISOString();
    } catch {
      // count 失敗 は 無視
    }
  }

  const { error } = await admin
    .from("line_segments")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    friend_count_cache: patch.friend_count_cache ?? null,
  });
}
