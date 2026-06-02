import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { updateAgencyTaskRequestSchema } from "@/lib/agency-tasks/types";

/**
 * PATCH /api/agency/tasks/[id]
 *
 * エージェント業務タスクを部分更新する。
 * - 認証 + organization_member ガード
 * - RLS により自社のタスクのみ更新可能。念のため organization_id でも絞る
 * - status を completed にしたら completed_at = now() を自動セット
 * - status を pending に戻したら completed_at をクリア
 * - 完了は組織内なら誰でも可(指示書方針:業務制限は UI/API 層で。RLS では絞らない)
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateAgencyTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const updateData: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.title !== undefined) updateData.title = d.title;
  if (d.status !== undefined) {
    updateData.status = d.status;
    // 完了/未完了の切り替えに合わせて completed_at を自動制御
    updateData.completed_at = d.status === "completed" ? new Date().toISOString() : null;
  }
  if (d.priority !== undefined) updateData.priority = d.priority;
  if (d.due_at !== undefined) updateData.due_at = d.due_at;
  if (d.assigned_member_id !== undefined) {
    // 担当を変える場合も、その担当者が自社かを検証
    const { data: memberRow } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("id", d.assigned_member_id)
      .maybeSingle();

    if (!memberRow || memberRow.organization_id !== role.organization.id) {
      return NextResponse.json(
        { error: "Assignee not found in your organization" },
        { status: 404 },
      );
    }
    updateData.assigned_member_id = d.assigned_member_id;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("agency_tasks")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", role.organization.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
