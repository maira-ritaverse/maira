import { NextResponse } from "next/server";

import { canExport } from "@/lib/permissions/server";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/agency/export/interviews
 *
 * 自社 の 面接 / 面談 履歴 (interviews) を CSV で 出力。
 *   面接日 / 種類 / 結果 / 紐づく 求人・顧客 / メモ
 *
 * 権限: admin OR export 権限 を 持つ advisor。
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

  // referrals → client_records / job_postings を join して 「誰 が」「どこ で」を 一発 で 出す
  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, kind, scheduled_at, result, notes, created_at, updated_at, referrals!inner(client_record_id, job_posting_id, status, client_records(name), job_postings(company_name, position))",
    )
    .eq("organization_id", role.organization.id)
    .order("scheduled_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    kind: string;
    scheduled_at: string;
    result: string;
    notes: string | null;
    created_at: string;
    updated_at: string;
    referrals:
      | {
          client_record_id: string;
          job_posting_id: string;
          status: string;
          client_records: { name: string } | { name: string }[] | null;
          job_postings:
            | { company_name: string; position: string }
            | { company_name: string; position: string }[]
            | null;
        }
      | Array<{
          client_record_id: string;
          job_posting_id: string;
          status: string;
          client_records: { name: string } | { name: string }[] | null;
          job_postings:
            | { company_name: string; position: string }
            | { company_name: string; position: string }[]
            | null;
        }>
      | null;
  };
  const rows = (data ?? []) as Row[];

  const header = [
    "面接 ID",
    "種類",
    "予定 日時",
    "結果",
    "顧客 名",
    "求人 企業",
    "求人 職種",
    "referral ステータス",
    "メモ",
    "作成 日時",
    "更新 日時",
  ];

  const data2 = rows.map((r) => {
    const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
    const client = ref
      ? Array.isArray(ref.client_records)
        ? ref.client_records[0]
        : ref.client_records
      : null;
    const job = ref
      ? Array.isArray(ref.job_postings)
        ? ref.job_postings[0]
        : ref.job_postings
      : null;
    return [
      csvFormat.text(r.id),
      csvFormat.text(r.kind),
      csvFormat.isoDateTime(r.scheduled_at),
      csvFormat.text(r.result),
      csvFormat.text(client?.name ?? null),
      csvFormat.text(job?.company_name ?? null),
      csvFormat.text(job?.position ?? null),
      csvFormat.text(ref?.status ?? null),
      csvFormat.text(r.notes),
      csvFormat.isoDateTime(r.created_at),
      csvFormat.isoDateTime(r.updated_at),
    ];
  });

  return csvResponse(toCsv([header, ...data2]), buildCsvFilename("interviews"));
}
