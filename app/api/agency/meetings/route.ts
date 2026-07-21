/**
 * POST /api/agency/meetings
 *
 * クライアント詳細から「面談を予約」する。
 *
 * 流れ:
 *   1. 認証 + 組織メンバ確認
 *   2. body をパース・バリデーション
 *   3. clientRecordId が現組織のものかを確認(RLS で SELECT が落ちる)
 *   4. provider に応じて外部サービスで会議作成
 *      ・zoom         : zoom_connections の access_token で REST API
 *      ・google_meet  : Phase 3 で実装(現状 501)
 *   5. meeting_schedules に行を作成
 *   6. レスポンスでビューを返す(UI 側で「予定一覧」を再フェッチさせる用)
 *
 * GET /api/agency/meetings
 *
 * 主催者本人の今後の予定を新しい順に返す(ダッシュボード「直近の予定」用)。
 */
import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { hasCalendarEventsScope } from "@/lib/integrations/google";
import { createGoogleCalendarEvent } from "@/lib/integrations/google-calendar";
import { createGoogleMeetEvent } from "@/lib/integrations/google-meet";
import { getGoogleAccessToken } from "@/lib/integrations/google-token";
import { hasMeetingWriteScope } from "@/lib/integrations/zoom";
import { createZoomMeeting } from "@/lib/integrations/zoom-meeting";
import { getZoomAccessToken } from "@/lib/integrations/zoom-token";
import { notifyMeetingScheduled } from "@/lib/meetings/notify";
import {
  insertMeetingSchedule,
  listUpcomingMeetingsForHost,
  markMeetingInvited,
} from "@/lib/meetings/queries";
import { createServiceClient } from "@/lib/supabase/service";
import { createMeetingSchema } from "@/lib/validations/meetings";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;

  try {
    const meetings = await listUpcomingMeetingsForHost(supabase, user.id, { limit: 20 });
    return NextResponse.json({ meetings });
  } catch (err) {
    return NextResponse.json(
      { error: "list_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, organization, supabase } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = createMeetingSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // 対象クライアントが自分の組織のものか確認(RLS で .single() が落ちる)
  // linked_user_id = Myaira 登録済求職者がある場合の auth.users 紐づけ
  const { data: clientRow, error: clientErr } = await supabase
    .from("client_records")
    .select("id, name, email, linked_user_id")
    .eq("id", input.clientRecordId)
    .maybeSingle();
  if (clientErr || !clientRow) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }
  const client = clientRow as {
    id: string;
    name: string;
    email: string | null;
    linked_user_id: string | null;
  };

  // ホスト本人の表示名(エージェントメンバ表示名 or email ローカル部)
  const { data: hostProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const hostDisplayName =
    (hostProfile as { display_name: string | null } | null)?.display_name ??
    user.email?.split("@")[0] ??
    "担当アドバイザー";

  // 終了時刻計算
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60 * 1000);

  // ─── provider 別の会議作成 ───────────────────────────────────────────
  let externalMeetingId: string;
  let joinUrl: string;
  let hostUrl: string | null = null;
  let passcode: string | null = null;

  if (input.provider === "zoom") {
    // Zoom:接続 + 認可スコープを確認
    const { data: zoomConn } = await supabase
      .from("zoom_connections")
      .select("user_id, scope, scopes_granted")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!zoomConn) {
      return NextResponse.json(
        { error: "zoom_not_connected", message: "Zoom 接続が必要です(設定→外部連携)" },
        { status: 409 },
      );
    }
    const scopeOk =
      hasMeetingWriteScope((zoomConn as { scope: string | null }).scope) ||
      ((zoomConn as { scopes_granted: string[] | null }).scopes_granted ?? []).includes(
        "meeting:write",
      );
    if (!scopeOk) {
      return NextResponse.json(
        {
          error: "zoom_scope_insufficient",
          message: "meeting:write の認可が必要です。Zoom を再接続してください。",
        },
        { status: 409 },
      );
    }

    const service = createServiceClient();
    let accessToken: string;
    try {
      const ctx = await getZoomAccessToken({ service, byUserId: user.id });
      accessToken = ctx.accessToken;
    } catch (err) {
      return NextResponse.json(
        { error: "zoom_token_failed", message: err instanceof Error ? err.message : "Unknown" },
        { status: 502 },
      );
    }

    try {
      const zoomMeeting = await createZoomMeeting(accessToken, {
        topic: input.title,
        startTime: input.startsAt,
        durationMinutes: input.durationMinutes,
        agenda: input.agenda,
        timezone: "Asia/Tokyo",
      });
      externalMeetingId = String(zoomMeeting.id);
      joinUrl = zoomMeeting.join_url;
      hostUrl = zoomMeeting.start_url;
      passcode = zoomMeeting.password ?? null;
    } catch (err) {
      return NextResponse.json(
        { error: "zoom_create_failed", message: err instanceof Error ? err.message : "Unknown" },
        { status: 502 },
      );
    }

    // Zoom 予約後、Google Calendar が接続されていればイベントを自動作成して
    // ホスト本人の Google カレンダーにも残す(Myaira / Zoom / Google の三重ブッキング防止)
    try {
      const { data: gconn } = await supabase
        .from("google_connections")
        .select("user_id, scope, scopes_granted")
        .eq("user_id", user.id)
        .maybeSingle();
      const gScopeOk =
        gconn &&
        (hasCalendarEventsScope((gconn as { scope: string | null }).scope) ||
          ((gconn as { scopes_granted: string[] | null }).scopes_granted ?? []).includes(
            "https://www.googleapis.com/auth/calendar.events",
          ));
      if (gconn && gScopeOk) {
        const gCtx = await getGoogleAccessToken({ service, userId: user.id });
        const desc = [
          input.agenda ?? "",
          input.agenda ? "" : null,
          `参加 URL: ${joinUrl}`,
          passcode ? `パスコード: ${passcode}` : null,
        ]
          .filter((s): s is string => s !== null)
          .join("\n");
        await createGoogleCalendarEvent(gCtx.accessToken, {
          summary: input.title,
          description: desc,
          location: joinUrl,
          startsAt: input.startsAt,
          endsAt: endsAt.toISOString(),
          timezone: "Asia/Tokyo",
          attendees: client.email ? [{ email: client.email, name: client.name }] : undefined,
        });
      }
    } catch {
      // Google 側の失敗は無視(Zoom 予約は成功している)。
      // 将来「同期失敗バッジ」を出したくなったら meeting_schedules に列を追加。
    }
  } else {
    // Google Meet:接続 + 認可スコープを確認
    const { data: googleConn } = await supabase
      .from("google_connections")
      .select("user_id, scope, scopes_granted")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!googleConn) {
      return NextResponse.json(
        { error: "google_not_connected", message: "Google 接続が必要です(設定→外部連携)" },
        { status: 409 },
      );
    }
    const scopeOk =
      hasCalendarEventsScope((googleConn as { scope: string | null }).scope) ||
      ((googleConn as { scopes_granted: string[] | null }).scopes_granted ?? []).includes(
        "https://www.googleapis.com/auth/calendar.events",
      );
    if (!scopeOk) {
      return NextResponse.json(
        {
          error: "google_scope_insufficient",
          message: "calendar.events の認可が必要です。Google を再接続してください。",
        },
        { status: 409 },
      );
    }

    const service = createServiceClient();
    let accessToken: string;
    try {
      const ctx = await getGoogleAccessToken({ service, userId: user.id });
      accessToken = ctx.accessToken;
    } catch (err) {
      return NextResponse.json(
        { error: "google_token_failed", message: err instanceof Error ? err.message : "Unknown" },
        { status: 502 },
      );
    }

    try {
      const { event, meetUrl } = await createGoogleMeetEvent(accessToken, {
        summary: input.title,
        description: input.agenda,
        startsAt: input.startsAt,
        endsAt: endsAt.toISOString(),
        timezone: "Asia/Tokyo",
        // 求職者メールがあれば attendee として含めるが、Google からの招待メールは
        // sendUpdates=none で抑止しているため Myaira 側のメールが主たる招待となる
        attendees: client.email ? [{ email: client.email, name: client.name }] : undefined,
      });
      externalMeetingId = event.id;
      joinUrl = meetUrl;
      // Google Meet は host 専用 URL や passcode を持たない
    } catch (err) {
      return NextResponse.json(
        { error: "google_create_failed", message: err instanceof Error ? err.message : "Unknown" },
        { status: 502 },
      );
    }
  }

  // ─── DB に保存 ──────────────────────────────────────────────────────
  let view;
  try {
    view = await insertMeetingSchedule(supabase, {
      provider: input.provider,
      clientRecordId: input.clientRecordId,
      title: input.title,
      agenda: input.agenda,
      startsAt: input.startsAt,
      endsAt: endsAt.toISOString(),
      durationMinutes: input.durationMinutes,
      timezone: "Asia/Tokyo",
      organizationId: organization.id,
      hostUserId: user.id,
      seekerUserId: client.linked_user_id,
      inviteeEmail: client.email,
      externalMeetingId,
      joinUrl,
      hostUrl,
      passcode,
    });
  } catch (err) {
    // 外部サービス側に会議が残ってしまうが、ここで失敗するのは DB 障害なので
    // ユーザーには成功フィードバックを出さず、運用で気づける形にする
    return NextResponse.json(
      {
        error: "db_insert_failed",
        message: err instanceof Error ? err.message : "Unknown",
        external_meeting_id: externalMeetingId,
      },
      { status: 500 },
    );
  }

  // ─── 招待通知の発火(メール + in-app + Slack)─ 失敗してもレスポンスは成功 ───
  const notifyResult = await notifyMeetingScheduled({
    meeting: view,
    hostUserId: user.id,
    hostDisplayName,
    organizationId: organization.id,
    organizationName: organization.name,
    inviteeName: client.name,
    inviteeEmail: client.email,
    seekerUserId: client.linked_user_id,
    variant: "invite",
  });

  // invited_at をマーク(リマインダー Cron 側でメール送信済かの判定に使う)
  try {
    await markMeetingInvited(supabase, view.id);
  } catch {
    // 失敗しても致命ではない(後段の Cron が再判定する)
  }

  return NextResponse.json(
    {
      meeting: view,
      notify: {
        emailSent: notifyResult.emailSent,
        emailError: notifyResult.emailError,
        inAppFired: notifyResult.inAppFired,
        slackFired: notifyResult.slackFired,
      },
    },
    { status: 201 },
  );
}
