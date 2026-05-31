import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createJobRequestSchema } from "@/lib/jobs/types";

/**
 * POST /api/agency/jobs
 *
 * 新規求人を登録する。
 * - 認証 + organization_member ガード
 * - 登録者の member.id を created_by_member_id に保存(誰が登録したか追跡)
 * - organization_id は呼び出し元の所属企業に固定(クライアントから受け取らない)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createJobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const d = parsed.data;

  const { data, error } = await supabase
    .from("job_postings")
    .insert({
      organization_id: role.organization.id,
      created_by_member_id: role.member.id,
      company_name: d.company_name,
      position: d.position,
      employment_type: d.employment_type || null,
      location: d.location || null,
      salary_min: d.salary_min ?? null,
      salary_max: d.salary_max ?? null,
      description: d.description || null,
      required_skills: d.required_skills || null,
      preferred_skills: d.preferred_skills || null,
      status: d.status,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create job", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, success: true });
}
