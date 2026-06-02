import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { listReferralsByOrganization } from "@/lib/referrals/queries";
import { getReferralStatusConfig } from "@/lib/referrals/types";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";

/**
 * GET /api/agency/export/referrals
 *
 * 自社の応募(referrals)一覧を CSV で返す。
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

  const refs = await listReferralsByOrganization(role.organization.id);

  const header = [
    "クライアント氏名",
    "クライアントメール",
    "求人企業名",
    "ポジション",
    "ステータス",
    "メモ",
    "登録日時",
    "更新日時",
  ];

  const data = refs.map((r) => [
    csvFormat.text(r.clientName),
    csvFormat.text(r.clientEmail),
    csvFormat.text(r.jobCompanyName),
    csvFormat.text(r.jobPosition),
    getReferralStatusConfig(r.status).label,
    csvFormat.text(r.notes),
    csvFormat.isoDateTime(r.createdAt),
    csvFormat.isoDateTime(r.updatedAt),
  ]);

  return csvResponse(toCsv([header, ...data]), buildCsvFilename("referrals"));
}
