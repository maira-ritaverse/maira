import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { listClientRecordsWithAssignee } from "@/lib/clients/queries";
import { EXPORT_COLUMNS, parseExportColumnsParam } from "@/lib/clients/export-columns";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";

/**
 * GET /api/agency/export/clients
 *
 * 自社のクライアント一覧を CSV で返す。
 * 権限:admin OR export 権限を持つ advisor のみ。
 * RLS で他社混入は防ぐが、organization_id 明示でも二重防御。
 *
 * 列選択:
 *   ?columns=name,email,phone,status,... のように列キーを指定。
 *   未指定なら DEFAULT_EXPORT_COLUMNS。
 *   列定義は lib/clients/export-columns.ts に集約。
 */
export async function GET(request: Request) {
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

  // 列選択をクエリから読み取り、列定義リストに引き当てる。
  const url = new URL(request.url);
  const columnKeys = parseExportColumnsParam(url.searchParams.get("columns"));
  const columns = columnKeys
    .map((k) => EXPORT_COLUMNS.find((c) => c.key === k))
    .filter((c): c is (typeof EXPORT_COLUMNS)[number] => c !== undefined);

  const rows = await listClientRecordsWithAssignee(role.organization.id);

  const header = columns.map((c) => c.label);
  const data = rows.map((c) =>
    columns.map((col) => {
      const raw = col.getValue(c);
      // 日付列は ISO のままだと長いので、ISO 日時系は短く整形する
      if (col.key === "created_at" || col.key === "updated_at") {
        return csvFormat.isoDateTime(raw);
      }
      return csvFormat.text(raw);
    }),
  );

  return csvResponse(toCsv([header, ...data]), buildCsvFilename("clients"));
}
