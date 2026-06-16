import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";

/**
 * POST /api/agency/agency-tasks/bulk
 *
 * 自分のタスク群に対する一括操作。
 *   - extend_due_at: 期限を N 日延長
 *   - mark_completed: 完了にする
 */

const MAX_IDS = 200;

const baseSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_IDS),
});

const extendSchema = baseSchema.extend({
  action: z.literal("extend_due_at"),
  days: z.number().int().min(1).max(365),
});

const markCompletedSchema = baseSchema.extend({
  action: z.literal("mark_completed"),
});

const requestSchema = z.discriminatedUnion("action", [extendSchema, markCompletedSchema]);

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = requestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { ids } = parsed.data;
  const orgId = organization.id;
  const memberId = member.id;

  if (parsed.data.action === "mark_completed") {
    const { data, error } = await supabase
      .from("agency_tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .in("id", ids)
      .eq("organization_id", orgId)
      .eq("assigned_member_id", memberId)
      .eq("status", "pending")
      .select("id");
    if (error) {
      return NextResponse.json(
        { error: "Failed to complete", message: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ updated: (data ?? []).length });
  }

  // extend_due_at
  const { data: oldRows, error: oldErr } = await supabase
    .from("agency_tasks")
    .select("id, due_at")
    .in("id", ids)
    .eq("organization_id", orgId)
    .eq("assigned_member_id", memberId)
    .eq("status", "pending");
  if (oldErr || !oldRows) {
    return NextResponse.json(
      { error: "Failed to load tasks", message: oldErr?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  const days = parsed.data.days;
  let updated = 0;
  for (const row of oldRows as Array<{ id: string; due_at: string | null }>) {
    const base = row.due_at ? new Date(row.due_at) : new Date();
    base.setDate(base.getDate() + days);
    const next = base.toISOString();
    const { error: updErr } = await supabase
      .from("agency_tasks")
      .update({ due_at: next })
      .eq("id", row.id)
      .eq("organization_id", orgId);
    if (updErr) {
      console.warn(`[bulk-tasks extend] update failed for ${row.id}:`, updErr.message);
      continue;
    }
    updated += 1;
  }

  return NextResponse.json({ updated });
}
