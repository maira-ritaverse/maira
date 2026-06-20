import { NextResponse } from "next/server";

import { canExport } from "@/lib/permissions/server";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/agency/export/line-broadcasts
 *
 * 自社 の LINE 一斉配信 履歴 (line_broadcasts) を CSV で 出力。
 * 本文 (encrypted_content) は 機密 性 と 列 サイズ の 観点 から CSV には 含めない。
 * 必要 なら 履歴 画面 から 個別 確認 (復号 表示) する 運用。
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

  const { data, error } = await supabase
    .from("line_broadcasts")
    .select(
      "id, message_type, target_filter, target_count, status, sent_count, failed_count, scheduled_for, sent_at, error_message, created_at",
    )
    .eq("organization_id", role.organization.id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    message_type: string;
    target_filter: {
      kind: "all" | "linked" | "unlinked";
      tagIds?: string[];
      jobIds?: string[];
    };
    target_count: number;
    status: string;
    sent_count: number;
    failed_count: number;
    scheduled_for: string | null;
    sent_at: string | null;
    error_message: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as Row[];

  const header = [
    "ID",
    "種類",
    "対象 区分",
    "タグ 数",
    "求人 数",
    "対象 友達 数",
    "状態",
    "送信 成功",
    "失敗",
    "予約 日時",
    "実行 日時",
    "エラー",
    "作成 日時",
  ];

  const data2 = rows.map((r) => [
    csvFormat.text(r.id),
    r.message_type === "flex" ? "求人 カード" : "テキスト",
    r.target_filter.kind === "all"
      ? "全 友達"
      : r.target_filter.kind === "linked"
        ? "連携済"
        : "未連携",
    csvFormat.number(r.target_filter.tagIds?.length ?? 0),
    csvFormat.number(r.target_filter.jobIds?.length ?? 0),
    csvFormat.number(r.target_count),
    csvFormat.text(r.status),
    csvFormat.number(r.sent_count),
    csvFormat.number(r.failed_count),
    csvFormat.isoDateTime(r.scheduled_for),
    csvFormat.isoDateTime(r.sent_at),
    csvFormat.text(r.error_message),
    csvFormat.isoDateTime(r.created_at),
  ]);

  return csvResponse(toCsv([header, ...data2]), buildCsvFilename("line-broadcasts"));
}
