import { NextResponse } from "next/server";

import { canExport } from "@/lib/permissions/server";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/agency/export/tasks
 *
 * 自社 の タスク (agency_tasks) を CSV で 出力。
 * 担当者 名 + 顧客 名 を join で 解決 して 1 行 完結 で 出す。
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

  // プラン tier に よる CSV エクスポート 可否 (Solo は 不可)。
  const plan = await getCurrentOrganizationPlan(supabase);
  const entitlements = getPlanEntitlements(plan?.tier ?? "standard");
  if (!entitlements.canUseCsvExport) {
    return NextResponse.json(
      {
        error: "feature_not_available",
        message: "CSV エクスポートはSolo Pro以上でご利用いただけます。",
      },
      { status: 402 },
    );
  }

  const { data, error } = await supabase
    .from("agency_tasks")
    .select(
      "id, title, status, priority, due_at, completed_at, created_at, updated_at, client_records(name), organization_members(profiles(display_name))",
    )
    .eq("organization_id", role.organization.id)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    title: string;
    status: string;
    priority: string | null;
    due_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    client_records: { name: string } | { name: string }[] | null;
    organization_members:
      | { profiles: { display_name: string | null } | { display_name: string | null }[] | null }
      | Array<{
          profiles: { display_name: string | null } | { display_name: string | null }[] | null;
        }>
      | null;
  };
  const rows = (data ?? []) as Row[];

  const header = [
    "ID",
    "タイトル",
    "状態",
    "優先度",
    "期限",
    "完了 日時",
    "顧客 名",
    "担当者",
    "作成 日時",
    "更新 日時",
  ];

  const data2 = rows.map((r) => {
    const client = Array.isArray(r.client_records) ? r.client_records[0] : r.client_records;
    const member = Array.isArray(r.organization_members)
      ? r.organization_members[0]
      : r.organization_members;
    const profile = member
      ? Array.isArray(member.profiles)
        ? member.profiles[0]
        : member.profiles
      : null;
    return [
      csvFormat.text(r.id),
      csvFormat.text(r.title),
      csvFormat.text(r.status),
      csvFormat.text(r.priority),
      csvFormat.isoDateTime(r.due_at),
      csvFormat.isoDateTime(r.completed_at),
      csvFormat.text(client?.name ?? null),
      csvFormat.text(profile?.display_name ?? null),
      csvFormat.isoDateTime(r.created_at),
      csvFormat.isoDateTime(r.updated_at),
    ];
  });

  return csvResponse(toCsv([header, ...data2]), buildCsvFilename("tasks"));
}
