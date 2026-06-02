import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { listClientRecordsWithAssignee } from "@/lib/clients/queries";
import { clientStatusLabels, clientLinkStatusLabels } from "@/lib/clients/types";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";

/**
 * GET /api/agency/export/clients
 *
 * 自社のクライアント一覧を CSV で返す。
 * 権限:admin OR export 権限を持つ advisor のみ。
 * RLS で他社混入は防ぐが、organization_id 明示でも二重防御。
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

  const rows = await listClientRecordsWithAssignee(role.organization.id);

  const header = [
    "氏名",
    "メール",
    "電話",
    "対応状況",
    "連携状況",
    "担当アドバイザー",
    "備考",
    "登録日時",
    "更新日時",
  ];

  const data = rows.map((c) => [
    csvFormat.text(c.name),
    csvFormat.text(c.email),
    csvFormat.text(c.phone),
    clientStatusLabels[c.status],
    clientLinkStatusLabels[c.linkStatus],
    csvFormat.text(c.assigneeName),
    csvFormat.text(c.notes),
    csvFormat.isoDateTime(c.createdAt),
    csvFormat.isoDateTime(c.updatedAt),
  ]);

  return csvResponse(toCsv([header, ...data]), buildCsvFilename("clients"));
}
