import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { updateJobRequestSchema } from "@/lib/jobs/types";

/**
 * PATCH /api/agency/jobs/[id]
 *
 * 求人を部分更新する。
 * - 認証 + organization_member ガード
 * - RLS により自社の求人のみ更新可能。念のため organization_id でも絞る
 *   (RLS が外れた場合の二重防御)。
 * - created_by_member_id は登録者を保持する目的なので更新対象に含めない。
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

  const parsed = updateJobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // undefined のフィールドは更新対象に含めない(部分更新)
  const updateData: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.company_name !== undefined) updateData.company_name = d.company_name;
  if (d.position !== undefined) updateData.position = d.position;
  if (d.employment_type !== undefined) updateData.employment_type = d.employment_type || null;
  if (d.location !== undefined) updateData.location = d.location || null;
  if (d.salary_min !== undefined) updateData.salary_min = d.salary_min;
  if (d.salary_max !== undefined) updateData.salary_max = d.salary_max;
  if (d.description !== undefined) updateData.description = d.description || null;
  if (d.required_skills !== undefined) updateData.required_skills = d.required_skills || null;
  if (d.preferred_skills !== undefined) updateData.preferred_skills = d.preferred_skills || null;
  if (d.status !== undefined) updateData.status = d.status;
  // 法定明示事項 8 列(マイグレーション 20260615000004)。
  // 空文字 → null に倒す(他の自由入力フィールドと同じ方針)。
  if (d.work_change_scope !== undefined) {
    updateData.work_change_scope = d.work_change_scope || null;
  }
  if (d.location_change_scope !== undefined) {
    updateData.location_change_scope = d.location_change_scope || null;
  }
  if (d.smoking_prevention_measure !== undefined) {
    updateData.smoking_prevention_measure = d.smoking_prevention_measure || null;
  }
  if (d.probation_period !== undefined) {
    updateData.probation_period = d.probation_period || null;
  }
  if (d.work_hours !== undefined) updateData.work_hours = d.work_hours || null;
  if (d.break_time !== undefined) updateData.break_time = d.break_time || null;
  if (d.holidays !== undefined) updateData.holidays = d.holidays || null;
  if (d.application_qualifications !== undefined) {
    updateData.application_qualifications = d.application_qualifications || null;
  }
  // 20260714000001。 成約報酬 (万円、 agency-private)。
  // 未指定 は 部分 更新 の セマンティクス に 合わせて スキップ、 明示 の null は 更新 する。
  if (d.placement_fee !== undefined) updateData.placement_fee = d.placement_fee;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("job_postings")
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
