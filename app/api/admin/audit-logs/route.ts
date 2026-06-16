import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/audit-logs?action=<enum>&limit=<n>
 *
 * 運営者用:監査ログの最新分を返す。
 *
 * - action 指定なしなら全種別
 * - 最大 200 件(MVP 規模)
 * - 削除済ユーザの行は user_id = NULL になっている(SET NULL)。metadata.email から
 *   元メアドを表示する。
 */
type Row = {
  id: string;
  user_id: string | null;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ALLOWED_ACTIONS = new Set([
  "login",
  "logout",
  "password_changed",
  "recovery_key_regenerated",
  "data_exported",
  "account_deleted",
  "subscription_changed",
  "admin_force_deleted_user",
  "account_export_requested",
  "privacy_policy_accepted",
  "admin_accessed_user",
]);

export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const actionParam = url.searchParams.get("action");
  const action = actionParam && ALLOWED_ACTIONS.has(actionParam) ? actionParam : null;
  const format = url.searchParams.get("format"); // "csv" で CSV ダウンロード
  // CSV は法令対応の控え用なので 1 度に多めに(2000 件)。JSON は UI 用に 200 上限。
  const limitRaw = Number(url.searchParams.get("limit") ?? (format === "csv" ? "2000" : "100"));
  const maxLimit = format === "csv" ? 5000 : 200;
  const limit = Number.isFinite(limitRaw)
    ? Math.min(maxLimit, Math.max(10, Math.trunc(limitRaw)))
    : format === "csv"
      ? 2000
      : 100;

  const admin = createServiceClient();
  let query = admin
    .from("audit_logs")
    .select("id, user_id, action, ip_address, user_agent, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (action) {
    query = query.eq("action", action);
  }
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed", message: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Row[];

  // CSV 形式:法令対応の控え用に取り出せるよう、Excel / スプレッドシート互換でフラット化
  if (format === "csv") {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `audit-logs-${today}${action ? `-${action}` : ""}.csv`;
    const csv = buildCsv(rows);
    // BOM を付けて Excel が UTF-8 として解釈できるように
    return new Response("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const logs = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    action: r.action,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    metadata: r.metadata,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ logs, total: logs.length });
}

/**
 * 監査ログ行を CSV にシリアライズ。
 * - メタデータは JSON 文字列で 1 列に
 * - ダブルクオート / 改行 / カンマを RFC 4180 に従ってエスケープ
 */
function buildCsv(rows: Row[]): string {
  const header = [
    "id",
    "created_at",
    "action",
    "user_id",
    "ip_address",
    "user_agent",
    "metadata_json",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.id),
        csvField(r.created_at),
        csvField(r.action),
        csvField(r.user_id ?? ""),
        csvField(r.ip_address ?? ""),
        csvField(r.user_agent ?? ""),
        csvField(r.metadata ? JSON.stringify(r.metadata) : ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function csvField(v: string): string {
  // RFC 4180:値に , " \r \n を含む場合は " で囲み、内部の " は "" にエスケープ
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
