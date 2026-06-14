/**
 * MA 送信履歴 CSV エクスポート
 *
 *   GET /api/agency/ma/logs/export?scenario=...&status=...
 *
 * 同 org メンバーが SELECT 可能なら誰でも実行可(運用上は管理職以外も監査することがある)。
 * 復号は内部で済ませて、CSV の中には平文が入る。
 *
 * クエリパラメータは UI のフィルタと同じ scenarioId / status を受け付ける。
 * 上限は安全側に倒して 1000 行(過剰負荷を防ぐ。ページング/UI からの要求は別途)。
 *
 * セキュリティメモ:
 *   - CSV インジェクション対策:セル先頭が = + - @ の場合は ' をプレフィックスして
 *     Excel で式として評価されないようにする
 *   - 改行・ダブルクォート・カンマを含むセルは "..." で囲み、内部の " は "" にエスケープ
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listScenarioViews, listSendLogs } from "@/lib/ma/queries";
import { parseLogDateRange, parseLogStatus } from "@/lib/ma/logs-filters";
import type { SendLog } from "@/lib/ma/types";

const MAX_ROWS = 1000;

export async function GET(request: Request) {
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

  // フィルタ解釈は UI ページと同じ純関数を使う(lib/ma/logs-filters、テスト済み)。
  // ?scenario= は組織内の uuid をそのまま使う(RLS が org でフィルタするので追加検証不要)。
  const url = new URL(request.url);
  const scenarioId = url.searchParams.get("scenario") ?? undefined;
  const status = parseLogStatus(url.searchParams.get("status"));
  const { dateFrom, dateTo } = parseLogDateRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );

  try {
    const [logs, scenarios] = await Promise.all([
      listSendLogs(role.organization.id, {
        scenarioId,
        status,
        dateFrom,
        dateTo,
        limit: MAX_ROWS,
      }),
      listScenarioViews(role.organization.id),
    ]);

    // scenario_id → preset.name で人間が読める形にする
    const scenarioNameById = new Map<string, string>();
    for (const v of scenarios) {
      if (v.activation) scenarioNameById.set(v.activation.id, v.preset.name);
    }

    const csv = buildCsv(logs, scenarioNameById);
    const filename = `ma-send-logs-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        // UTF-8 BOM 付き(Excel で文字化けしないため)
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to export logs", message }, { status: 500 });
  }
}

/**
 * SendLog 配列を CSV 文字列に変換する。
 * UTF-8 BOM 付き(Excel が UTF-8 と認識して日本語が化けないため)。
 */
function buildCsv(logs: SendLog[], scenarioNameById: Map<string, string>): string {
  const header = [
    "送信日時",
    "シナリオ",
    "受信者メール",
    "件名",
    "本文",
    "ステータス",
    "エラー",
    "Resend ID",
  ];
  const rows: string[] = [header.map(escapeCell).join(",")];
  for (const log of logs) {
    rows.push(
      [
        log.sentAt,
        scenarioNameById.get(log.scenarioId) ?? "(削除済シナリオ)",
        log.recipientEmail,
        log.subject,
        log.body,
        log.status,
        log.errorMessage ?? "",
        log.resendMessageId ?? "",
      ]
        .map(escapeCell)
        .join(","),
    );
  }
  // BOM + CRLF(Excel 互換のため改行は \r\n)
  return "﻿" + rows.join("\r\n") + "\r\n";
}

/**
 * CSV 1 セルの値をエスケープする純粋関数。
 *   - = + - @ で始まる場合は ' を前置(CSV インジェクション対策)
 *   - " カンマ 改行 を含む場合は "..." で囲み、" は "" にエスケープ
 *
 * テストしやすいよう named export しても良いが、今回は API ルート内部に閉じる。
 */
function escapeCell(value: string): string {
  let v = value;
  // CSV インジェクション対策:Excel で式として評価される文字を無効化
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  // 特殊文字を含む場合は囲む
  if (/[",\r\n]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
