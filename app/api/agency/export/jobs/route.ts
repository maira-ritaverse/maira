import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { listJobPostings } from "@/lib/jobs/queries";
import { jobStatusLabels, formatSalaryRange } from "@/lib/jobs/types";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";

/**
 * GET /api/agency/export/jobs
 *
 * 自社の求人一覧を CSV で返す。
 * 権限:admin OR export 権限を持つ advisor のみ。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canExport(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jobs = await listJobPostings(role.organization.id);

  const header = [
    "求人企業名",
    "職種",
    "雇用形態",
    "勤務地",
    "年収下限(万円)",
    "年収上限(万円)",
    "年収レンジ",
    "ステータス",
    "登録日時",
    "更新日時",
  ];

  const data = jobs.map((j) => [
    csvFormat.text(j.companyName),
    csvFormat.text(j.position),
    csvFormat.text(j.employmentType),
    csvFormat.text(j.location),
    csvFormat.number(j.salaryMin),
    csvFormat.number(j.salaryMax),
    formatSalaryRange(j.salaryMin, j.salaryMax),
    jobStatusLabels[j.status],
    csvFormat.isoDateTime(j.createdAt),
    csvFormat.isoDateTime(j.updatedAt),
  ]);

  return csvResponse(toCsv([header, ...data]), buildCsvFilename("jobs"));
}
