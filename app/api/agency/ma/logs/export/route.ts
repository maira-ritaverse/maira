/**
 * MA 送信履歴 CSV エクスポート
 *
 *   GET /api/agency/ma/logs/export?scenario=...&status=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 同 org メンバーが SELECT 可能なら誰でも実行可(運用上は管理職以外も監査することがある)。
 * 復号は内部で済ませて、CSV の中には平文が入る。
 *
 * クエリパラメータは UI のフィルタと同じ scenarioId / status / 日付範囲を受け付ける。
 * 解釈は lib/ma/logs-filters の純関数を使い、UI と完全に同じ挙動を保証する。
 * 上限は安全側に倒して 1000 行(過剰負荷を防ぐ。UI のページング範囲を超える要求は別途)。
 *
 * CSV の組み立て・インジェクション対策・ファイル名・ダウンロードヘッダは
 * すべて lib/csv の共通 util に集約済み(他の admin/jobs/clients/referrals 等と同じ実装)。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listScenarioViews, listSendLogs } from "@/lib/ma/queries";
import { parseLogDateRange, parseLogStatus } from "@/lib/ma/logs-filters";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";

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
    const rows = logs.map((log) => [
      csvFormat.isoDateTime(log.sentAt),
      csvFormat.text(scenarioNameById.get(log.scenarioId) ?? "(削除済シナリオ)"),
      csvFormat.text(log.recipientEmail),
      csvFormat.text(log.subject),
      csvFormat.text(log.body),
      csvFormat.text(log.status),
      csvFormat.text(log.errorMessage),
      csvFormat.text(log.resendMessageId),
    ]);

    const csv = toCsv([header, ...rows]);
    const filename = buildCsvFilename("ma-send-logs");
    return csvResponse(csv, filename);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to export logs", message }, { status: 500 });
  }
}
