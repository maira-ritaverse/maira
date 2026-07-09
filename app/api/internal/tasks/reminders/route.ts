/**
 * POST/GET /api/internal/tasks/reminders
 *
 * 求職者 の タスク 期限 リマインド Cron。
 *
 * 対象: public.tasks (求職者 本人 の タスク)
 *   ・status = 'pending' & reminded_at IS NULL & due_at IN [now, now + 24h]
 *
 * 通知 方法:
 *   1. 求職者 が client_records.linked_user_id 経由 で LINE 連携 済 (line_user_links)
 *      なら、 組織 の LINE Bot 経由 で push メッセージ。
 *   2. LINE 連携 が 無 い / 送信 失敗 でも reminded_at は 埋め、 再 送 を 防ぐ。
 *
 * 認証: 既存 の checkCronAuth (INTAKE_CRON_SECRET) を 流用。
 * 制限: 1 回 で 最大 50 件 (レート 制限 対策)。
 */
import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { decryptField } from "@/lib/crypto/field-encryption";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { sendTextMessage } from "@/lib/line/messaging";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildReminderText,
  selectDueTasks,
  type TaskCandidate,
} from "@/lib/tasks/reminder-selector";

const WINDOW_HOURS = 24;
const BATCH_LIMIT = 50;

type TaskRow = {
  id: string;
  user_id: string;
  encrypted_title_v2: string | null;
  due_at: string;
  status: string;
  reminded_at: string | null;
};

type LineTarget = {
  organizationId: string;
  lineUserId: string;
};

async function findLineTarget(
  service: ReturnType<typeof createServiceClient>,
  seekerUserId: string,
): Promise<LineTarget | null> {
  // 求職者 の user_id と 紐付いた client_records を 引く
  const { data: clientRow } = await service
    .from("client_records")
    .select("id, organization_id")
    .eq("linked_user_id", seekerUserId)
    .maybeSingle();
  if (!clientRow) return null;

  // その client_record に 紐 付く LINE 友達 (未 ブロック)
  const { data: linkRow } = await service
    .from("line_user_links")
    .select("line_user_id, unfollowed_at")
    .eq("client_record_id", clientRow.id)
    .is("unfollowed_at", null)
    .maybeSingle();
  if (!linkRow) return null;

  return {
    organizationId: clientRow.organization_id,
    lineUserId: linkRow.line_user_id,
  };
}

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json(
        { error: "CRON_SECRET / INTAKE_CRON_SECRET 未 設定" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

  // 候補 の 一括 取得 (index idx_tasks_pending_due で 高速)
  const { data, error } = await service
    .from("tasks")
    .select("id, user_id, encrypted_title_v2, due_at, status, reminded_at")
    .eq("status", "pending")
    .is("reminded_at", null)
    .gte("due_at", now.toISOString())
    .lte("due_at", windowEnd.toISOString())
    .order("due_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: "fetch failed", details: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as TaskRow[];

  // 純粋 関数 で window 再 確認 (レース 対策 + テスト 容易 性)
  const candidates: TaskCandidate[] = rows.map((r) => ({
    id: r.id,
    dueAt: r.due_at,
    status: r.status,
    remindedAt: r.reminded_at,
  }));
  const selected = selectDueTasks(candidates, { start: now, end: windowEnd });
  const selectedIds = new Set(selected.map((s) => s.id));
  const targets = rows.filter((r) => selectedIds.has(r.id));

  let sentLine = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of targets) {
    try {
      const title = row.encrypted_title_v2
        ? ((await decryptField(row.encrypted_title_v2)) ?? "(タイトル 復号 失敗)")
        : "(タイトル なし)";

      const target = await findLineTarget(service, row.user_id);
      if (target) {
        const channel = await getLineChannelByOrgId(service, target.organizationId);
        if (channel) {
          const text = buildReminderText(title, row.due_at);
          const result = await sendTextMessage(
            service,
            target.organizationId,
            target.lineUserId,
            channel.channelAccessToken,
            text,
          );
          if (result.ok) {
            sentLine++;
          } else {
            failed++;
            errors.push({ id: row.id, error: `line: ${result.reason}` });
          }
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }

      // 送信 の 成 否 に 関わ らず reminded_at を 埋 めて 再 送 を 防ぐ
      // (送信 失敗 = 一時 障害 と 想定 し つつ、 求職者 が 何度 も 同じ push を
      // 受ける の を 避ける 方 が UX 上 望ましい)
      await service.from("tasks").update({ reminded_at: now.toISOString() }).eq("id", row.id);
    } catch (err) {
      failed++;
      errors.push({ id: row.id, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    scanned: rows.length,
    processed: targets.length,
    sent_line: sentLine,
    skipped_no_line: skipped,
    failed,
    errors: errors.slice(0, 10),
  });
}

// Vercel Cron は GET で も 叩く 可能性 が ある ため 両方 サポート
export const GET = POST;
