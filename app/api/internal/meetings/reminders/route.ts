/**
 * POST/GET /api/internal/meetings/reminders
 *
 * 面談予約リマインダーを送る Vercel Cron。
 *
 * 認証:
 *   ・既存と統一して INTAKE_CRON_SECRET を使う(別シークレットを増やす意味は薄い)
 *   ・将来別シークレットに分けたくなったら REMINDER_CRON_SECRET を読むよう拡張
 *
 * 処理:
 *   - now < starts_at < now + 24h かつ reminder_24h_sent_at IS NULL → 24h リマインド送る
 *   - now < starts_at < now + 1h  かつ reminder_1h_sent_at  IS NULL → 1h リマインド送る
 *
 * 各回最大 50 件処理。それを超える分は次回 cron で処理(極端な詰まりは想定外)。
 *
 * Cron 頻度:
 *   ・vercel.json で 10 分間隔(cron 式 "asterisk-slash-10 * * * *")を推奨
 *   ・1 件あたりメール送信 1 回 + DB 更新 1 回。Resend のレート上限内に収まる範囲。
 */
import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { notifyMeetingScheduled } from "@/lib/meetings/notify";
import { markReminderSent } from "@/lib/meetings/queries";
import type { MeetingScheduleRow, MeetingScheduleView } from "@/lib/meetings/types";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

async function rowToView(row: MeetingScheduleRow): Promise<MeetingScheduleView> {
  const agenda = row.encrypted_agenda ? ((await decryptField(row.encrypted_agenda)) ?? "") : "";
  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    agenda,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    status: row.status,
    joinUrl: row.join_url,
    hostUrl: row.host_url,
    passcode: row.passcode,
    clientRecordId: row.client_record_id,
    seekerUserId: row.seeker_user_id,
    inviteeEmail: row.invitee_email,
    recordingId: row.recording_id,
    invitedAt: row.invited_at,
    reminder24hSentAt: row.reminder_24h_sent_at,
    reminder1hSentAt: row.reminder_1h_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type PendingMeeting = MeetingScheduleRow & {
  reminder_kind: "24h" | "1h";
};

async function fetchPending(
  service: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<PendingMeeting[]> {
  const upper24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const upper1h = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  // 24h リマインダーが必要な行(starts_at < now+24h AND reminder_24h_sent_at IS NULL)
  const { data: rows24, error: e24 } = await service
    .from("meeting_schedules")
    .select("*")
    .eq("status", "scheduled")
    .gte("starts_at", nowIso)
    .lt("starts_at", upper24h)
    .is("reminder_24h_sent_at", null)
    .order("starts_at", { ascending: true })
    .limit(50);
  if (e24) throw new Error(`fetch reminder24 failed: ${e24.message}`);

  // 1h リマインダー
  const { data: rows1, error: e1 } = await service
    .from("meeting_schedules")
    .select("*")
    .eq("status", "scheduled")
    .gte("starts_at", nowIso)
    .lt("starts_at", upper1h)
    .is("reminder_1h_sent_at", null)
    .order("starts_at", { ascending: true })
    .limit(50);
  if (e1) throw new Error(`fetch reminder1 failed: ${e1.message}`);

  const out: PendingMeeting[] = [];
  for (const r of (rows24 as MeetingScheduleRow[] | null) ?? []) {
    out.push({ ...r, reminder_kind: "24h" });
  }
  // 1h は 24h と重複しうるが、変数が別カラムなので両方送って良い設計
  for (const r of (rows1 as MeetingScheduleRow[] | null) ?? []) {
    out.push({ ...r, reminder_kind: "1h" });
  }
  return out;
}

type HostMeta = { displayName: string; organizationName: string };

async function getHostAndOrgMeta(
  service: ReturnType<typeof createServiceClient>,
  hostUserId: string,
  organizationId: string | null,
): Promise<HostMeta> {
  const [{ data: profile }, { data: org }] = await Promise.all([
    service.from("profiles").select("display_name").eq("id", hostUserId).maybeSingle(),
    organizationId
      ? service.from("organizations").select("name").eq("id", organizationId).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);
  return {
    displayName:
      (profile as { display_name: string | null } | null)?.display_name ?? "担当アドバイザー",
    organizationName: (org as { name: string } | null)?.name ?? "Maira",
  };
}

async function getClientName(
  service: ReturnType<typeof createServiceClient>,
  clientRecordId: string | null,
): Promise<string> {
  if (!clientRecordId) return "求職者";
  const { data } = await service
    .from("client_records")
    .select("name")
    .eq("id", clientRecordId)
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? "求職者";
}

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json(
        {
          error:
            "CRON_SECRET / INTAKE_CRON_SECRET 未設定のため、本エンドポイントは無効化されています",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const now = new Date();
  const pending = await fetchPending(service, now);

  let sentCount = 0;
  let failedCount = 0;
  const errors: Array<{ id: string; kind: "24h" | "1h"; error: string }> = [];

  for (const row of pending) {
    try {
      const view = await rowToView(row);
      const hostMeta = await getHostAndOrgMeta(service, row.host_user_id, row.organization_id);
      const inviteeName = await getClientName(service, row.client_record_id);

      await notifyMeetingScheduled({
        meeting: view,
        hostUserId: row.host_user_id,
        hostDisplayName: hostMeta.displayName,
        organizationId: row.organization_id ?? "",
        organizationName: hostMeta.organizationName,
        inviteeName,
        inviteeEmail: row.invitee_email,
        seekerUserId: row.seeker_user_id,
        variant: row.reminder_kind === "24h" ? "reminder_24h" : "reminder_1h",
      });

      // 送信成功(または送信できない設定でも) reminder_*_sent_at を埋めて再送防止
      await markReminderSent(service, row.id, row.reminder_kind);
      sentCount++;
    } catch (err) {
      failedCount++;
      errors.push({
        id: row.id,
        kind: row.reminder_kind,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    processed: pending.length,
    sent: sentCount,
    failed: failedCount,
    errors: errors.slice(0, 10),
  });
}

// Vercel Cron は GET でも叩く可能性があるため両方サポート
export const GET = POST;
