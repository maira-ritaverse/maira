/**
 * DELETE /api/agency/meetings/[id]
 *
 * 面談予約をキャンセルする。Zoom / Google Meet 側も削除して、
 * meeting_schedules.status を 'canceled' にする。
 *
 * RLS により host_user_id 一致または組織 admin のみが実行可能。
 *
 * GET /api/agency/meetings/[id]
 *   1 件の詳細取得(UI の編集モーダル用)
 */
import { NextResponse } from "next/server";

import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { updateGoogleEvent, deleteGoogleEvent } from "@/lib/integrations/google-meet";
import { getGoogleAccessToken } from "@/lib/integrations/google-token";
import { deleteZoomMeeting, updateZoomMeeting } from "@/lib/integrations/zoom-meeting";
import { getZoomAccessToken } from "@/lib/integrations/zoom-token";
import { notifyMeetingScheduled } from "@/lib/meetings/notify";
import {
  getMeetingScheduleById,
  rescheduleMeeting,
  updateMeetingStatus,
} from "@/lib/meetings/queries";
import { createServiceClient } from "@/lib/supabase/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;
  const { id } = await context.params;

  try {
    const meeting = await getMeetingScheduleById(supabase, id);
    if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ meeting });
  } catch (err) {
    return NextResponse.json(
      { error: "get_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, member } = guard;
  const { id } = await context.params;

  // schedule の view と external_meeting_id を同時に取る
  const meeting = await getMeetingScheduleById(supabase, id);
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // host_user_id は view に 含まれ ない の で 直接 引く
  const { data: hostRow } = await supabase
    .from("meeting_schedules")
    .select("host_user_id")
    .eq("id", id)
    .maybeSingle();
  const meetingHostUserId = (hostRow as { host_user_id: string } | null)?.host_user_id ?? null;

  // M2 修正: host / admin 以外 の 削除 を 拒否。 旧 挙動 で は 同 org の 別 advisor が
  // ホスト の meeting を DELETE で 叩く と、 攻撃者 の Zoom トークン で 他人 の
  // 会議 を 削除 API に 叩き、 一方 DB は RLS で silent no-op で success=true が
  // 返り 事故 化 した。
  if (meetingHostUserId !== user.id && member.role !== "admin") {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "この 会議 の 削除 は ホスト 本人 か 管理者 のみ 可能 です。",
      },
      { status: 403 },
    );
  }

  const { data: extRow } = await supabase
    .from("meeting_schedules")
    .select("external_meeting_id")
    .eq("id", id)
    .maybeSingle();
  const externalId =
    (extRow as { external_meeting_id: string } | null)?.external_meeting_id ?? null;

  // ─── 外部サービス側の削除(失敗しても DB のキャンセル更新は進める)─────
  let externalDeleteWarning: string | null = null;

  if (meeting.provider === "zoom" && externalId) {
    try {
      const service = createServiceClient();
      const ctx = await getZoomAccessToken({ service, byUserId: user.id });
      await deleteZoomMeeting(ctx.accessToken, externalId);
    } catch (err) {
      externalDeleteWarning = err instanceof Error ? err.message : "unknown";
    }
  } else if (meeting.provider === "google_meet" && externalId) {
    try {
      const service = createServiceClient();
      const ctx = await getGoogleAccessToken({ service, userId: user.id });
      await deleteGoogleEvent(ctx.accessToken, externalId);
    } catch (err) {
      externalDeleteWarning = err instanceof Error ? err.message : "unknown";
    }
  }

  try {
    await updateMeetingStatus(supabase, id, "canceled");
  } catch (err) {
    return NextResponse.json(
      { error: "db_update_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }

  // キャンセル通知(求職者本人 + 組織メンバー)
  try {
    const { data: orgProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    const hostDisplayName =
      (orgProfile as { display_name: string | null } | null)?.display_name ?? "担当者";

    let inviteeName = "求職者";
    if (meeting.clientRecordId) {
      const { data: cr } = await supabase
        .from("client_records")
        .select("name")
        .eq("id", meeting.clientRecordId)
        .maybeSingle();
      inviteeName = (cr as { name: string | null } | null)?.name ?? inviteeName;
    }

    let organizationName = "Maira";
    let organizationId = "";
    const { data: roleRow } = await supabase
      .from("organization_members")
      .select("organization_id, organizations(name)")
      .eq("user_id", user.id)
      // soft delete された メンバー は 除外
      .is("removed_at", null)
      .maybeSingle();
    if (roleRow) {
      const r = roleRow as {
        organization_id: string;
        organizations: { name: string } | { name: string }[] | null;
      };
      organizationId = r.organization_id;
      organizationName = Array.isArray(r.organizations)
        ? (r.organizations[0]?.name ?? "Maira")
        : (r.organizations?.name ?? "Maira");
    }

    await notifyMeetingScheduled({
      meeting,
      hostUserId: user.id,
      hostDisplayName,
      organizationId,
      organizationName,
      inviteeName,
      inviteeEmail: meeting.inviteeEmail,
      seekerUserId: meeting.seekerUserId,
      variant: "cancel",
    });
  } catch {
    // 通知失敗は致命ではない
  }

  return NextResponse.json({
    success: true,
    externalDeleteWarning,
  });
}

// ─── PATCH: 再スケジュール / タイトル変更 ───────────────────────────────
const patchSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  agenda: z.string().max(4000).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(5).max(360).optional(),
});

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, member } = guard;
  const { id } = await context.params;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = patchSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // 既存予約を取得
  const meeting = await getMeetingScheduleById(supabase, id);
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // host_user_id は view に 含まれ ない の で 直接 引く
  const { data: hostRow } = await supabase
    .from("meeting_schedules")
    .select("host_user_id")
    .eq("id", id)
    .maybeSingle();
  const meetingHostUserId = (hostRow as { host_user_id: string } | null)?.host_user_id ?? null;

  // M2 修正: host / admin 以外 の 変更 を 拒否 (DELETE と 同 パターン)。
  if (meetingHostUserId !== user.id && member.role !== "admin") {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "この 会議 の 変更 は ホスト 本人 か 管理者 のみ 可能 です。",
      },
      { status: 403 },
    );
  }

  const { data: extRow } = await supabase
    .from("meeting_schedules")
    .select("external_meeting_id")
    .eq("id", id)
    .maybeSingle();
  const externalId =
    (extRow as { external_meeting_id: string } | null)?.external_meeting_id ?? null;

  // ends_at を再計算(durationMinutes 指定があれば、startsAt がなければ既存の startsAt 起点)
  const startsAt = input.startsAt ?? meeting.startsAt;
  let endsAt: string | undefined;
  if (input.durationMinutes !== undefined) {
    endsAt = new Date(
      new Date(startsAt).getTime() + input.durationMinutes * 60 * 1000,
    ).toISOString();
  } else if (input.startsAt !== undefined) {
    // 元の長さを維持して endsAt を再計算
    const oldDuration = new Date(meeting.endsAt).getTime() - new Date(meeting.startsAt).getTime();
    endsAt = new Date(new Date(input.startsAt).getTime() + oldDuration).toISOString();
  }

  // ─── 外部サービス側を更新(失敗しても DB 更新は試す) ─────────────
  let externalUpdateWarning: string | null = null;
  if (externalId) {
    if (meeting.provider === "zoom") {
      try {
        const service = createServiceClient();
        const ctx = await getZoomAccessToken({ service, byUserId: user.id });
        await updateZoomMeeting(ctx.accessToken, externalId, {
          topic: input.title,
          startTime: input.startsAt,
          durationMinutes: input.durationMinutes,
          agenda: input.agenda,
        });
      } catch (err) {
        externalUpdateWarning = err instanceof Error ? err.message : "unknown";
      }
    } else if (meeting.provider === "google_meet") {
      try {
        const service = createServiceClient();
        const ctx = await getGoogleAccessToken({ service, userId: user.id });
        await updateGoogleEvent(ctx.accessToken, externalId, {
          summary: input.title,
          description: input.agenda,
          startsAt: input.startsAt,
          endsAt,
          timezone: "Asia/Tokyo",
        });
      } catch (err) {
        externalUpdateWarning = err instanceof Error ? err.message : "unknown";
      }
    }
  }

  // ─── DB を更新 ──────────────────────────────────────────────────
  let updated;
  try {
    updated = await rescheduleMeeting(supabase, id, {
      title: input.title,
      agenda: input.agenda,
      startsAt: input.startsAt,
      endsAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "db_update_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }

  // ─── 変更通知(招待と同じ流れで .ics 再送 + in-app + Slack)─────
  try {
    const { data: orgProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    const hostDisplayName =
      (orgProfile as { display_name: string | null } | null)?.display_name ?? "担当者";
    let inviteeName = "求職者";
    if (updated.clientRecordId) {
      const { data: cr } = await supabase
        .from("client_records")
        .select("name")
        .eq("id", updated.clientRecordId)
        .maybeSingle();
      inviteeName = (cr as { name: string | null } | null)?.name ?? inviteeName;
    }
    let organizationName = "Maira";
    let organizationId = "";
    const { data: roleRow } = await supabase
      .from("organization_members")
      .select("organization_id, organizations(name)")
      .eq("user_id", user.id)
      // soft delete された メンバー は 除外
      .is("removed_at", null)
      .maybeSingle();
    if (roleRow) {
      const r = roleRow as {
        organization_id: string;
        organizations: { name: string } | { name: string }[] | null;
      };
      organizationId = r.organization_id;
      organizationName = Array.isArray(r.organizations)
        ? (r.organizations[0]?.name ?? "Maira")
        : (r.organizations?.name ?? "Maira");
    }
    await notifyMeetingScheduled({
      meeting: updated,
      hostUserId: user.id,
      hostDisplayName,
      organizationId,
      organizationName,
      inviteeName,
      inviteeEmail: updated.inviteeEmail,
      seekerUserId: updated.seekerUserId,
      variant: "invite", // 変更も再招待として扱う(.ics の SEQUENCE は将来要拡張)
    });
  } catch {
    // 通知失敗は致命ではない
  }

  return NextResponse.json({ meeting: updated, externalUpdateWarning });
}
