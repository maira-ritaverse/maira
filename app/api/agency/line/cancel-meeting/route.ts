import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { deleteZoomMeeting } from "@/lib/integrations/zoom-meeting";
import { getZoomAccessToken } from "@/lib/integrations/zoom-token";
import { sendTextMessage } from "@/lib/line/messaging";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/cancel-meeting
 *
 * 確定済 面談 を キャンセル し、 LINE で 求職者 に 通知 する。
 *
 * 流れ:
 *   1. meeting_schedules を 自組織 + scheduled で 取得
 *   2. Zoom 会議 を 削除 (失敗しても 続行 — host 側 で 残るだけ)
 *   3. meeting_schedules.status = 'canceled'
 *   4. LINE で 通知 (Push: 30 秒以内 の Reply Token は 通常 期待 できない)
 *
 * 入力:
 *   { meetingScheduleId, reason?: string }
 */
const bodySchema = z.object({
  meetingScheduleId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { meetingScheduleId, reason } = parsed.data;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);

  // 自組織 の meeting_schedule を 取得
  const { data: msRow } = await admin
    .from("meeting_schedules")
    .select(
      "id, organization_id, host_user_id, client_record_id, provider, external_meeting_id, title, starts_at, status",
    )
    .eq("id", meetingScheduleId)
    .eq("organization_id", guard.organization.id)
    .maybeSingle();
  type MsRow = {
    id: string;
    organization_id: string;
    host_user_id: string;
    client_record_id: string | null;
    provider: "zoom" | "google_meet";
    external_meeting_id: string;
    title: string;
    starts_at: string;
    status: "scheduled" | "completed" | "canceled" | "no_show";
  };
  const meeting = msRow as MsRow | null;
  if (!meeting) {
    return NextResponse.json({ error: "meeting_not_found" }, { status: 404 });
  }
  if (meeting.status !== "scheduled") {
    return NextResponse.json(
      { error: "meeting_not_cancelable", message: `現状態: ${meeting.status}` },
      { status: 409 },
    );
  }

  // Zoom 会議 を 削除 (失敗 しても DB 更新 は 続行)
  if (meeting.provider === "zoom") {
    try {
      const zoomCtx = await getZoomAccessToken({
        service: admin,
        byUserId: meeting.host_user_id,
      });
      await deleteZoomMeeting(zoomCtx.accessToken, meeting.external_meeting_id);
    } catch (err) {
      console.warn("[line/cancel-meeting] zoom delete failed (continuing)", {
        meetingId: meeting.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ステータス更新
  const { error: updErr } = await admin
    .from("meeting_schedules")
    .update({ status: "canceled" })
    .eq("id", meeting.id);
  if (updErr) {
    return NextResponse.json({ error: "update_failed", message: updErr.message }, { status: 500 });
  }

  // LINE で 通知 (client_record 経由 で line_user_id を 引く)
  let lineNotificationSent = false;
  if (meeting.client_record_id && channel) {
    const { data: linkRow } = await admin
      .from("line_user_links")
      .select("line_user_id, unfollowed_at")
      .eq("organization_id", guard.organization.id)
      .eq("client_record_id", meeting.client_record_id)
      .maybeSingle();
    const link = linkRow as { line_user_id: string; unfollowed_at: string | null } | null;
    if (link && !link.unfollowed_at) {
      const startsAtText = formatJstDateTime(meeting.starts_at);
      const lines = [
        `「${meeting.title}」 (${startsAtText}) を キャンセル しました。`,
        reason ? "" : null,
        reason ? `理由: ${reason}` : null,
        ``,
        `改めて 候補日 を ご案内 します。`,
      ].filter((line) => line !== null);
      const result = await sendTextMessage(
        admin,
        guard.organization.id,
        link.line_user_id,
        channel.channelAccessToken,
        lines.join("\n"),
      );
      lineNotificationSent = result.ok;
    }
  }

  return NextResponse.json({
    ok: true,
    meetingScheduleId,
    lineNotificationSent,
  });
}

function formatJstDateTime(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const day = "日月火水木金土"[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} (${day}) ${hh}:${mi}`;
}
