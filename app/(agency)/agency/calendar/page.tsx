import { redirect } from "next/navigation";

import { GoogleConnectBanner } from "@/components/features/integrations/google-connect-banner";
import { NextMeetingWidget } from "@/components/features/meetings/next-meeting-widget";
import { createClient } from "@/lib/supabase/server";
import { getGoogleConnectionStatus } from "@/lib/integrations/connection-status";
import { getNextMeetingForHost } from "@/lib/meetings/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { listCalendarEvents } from "@/lib/calendar/queries";

import { CalendarView } from "./calendar-view";

/**
 * カレンダー画面(月表示)
 *
 * 組織内の日付ベースイベント(面談予定 / 受付 / タスク期限 / 対応履歴)を
 * 月次グリッドで一覧。月切替時はクライアント側で /api/agency/calendar を fetch。
 *
 * 初期月はサーバー時刻ベースの「現在月」。
 * Date.now() は use server 環境では使って良い(ハイドレーション差分の懸念無し)。
 */
export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  // 現在月の最初の日と最終日(YYYY-MM-DD)を計算する。
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const initialMonth = `${year}-${String(month).padStart(2, "0")}`;
  // M1: 週 / 日ビューの初期アンカー日 (今日の日付)。month view でも参照される。
  const initialAnchorDate = `${initialMonth}-${String(now.getDate()).padStart(2, "0")}`;
  // クエリ範囲は当月 + 前後 1 週(月をまたぐ予定が表示される)
  const start = new Date(year, month - 1, 1 - 7);
  const end = new Date(year, month, 7);
  const rangeStart = toIsoDate(start);
  const rangeEnd = toIsoDate(end);

  const [events, googleStatus, nextMeeting] = await Promise.all([
    listCalendarEvents({
      organizationId: role.organization.id,
      rangeStart,
      rangeEnd,
    }),
    getGoogleConnectionStatus(supabase, user.id),
    getNextMeetingForHost(supabase, user.id, { withinHours: 24 }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">カレンダー</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          面談予定 / 受付 / タスク期限 / 対応履歴 を月次で一望できます
        </p>
      </div>
      <NextMeetingWidget initial={nextMeeting} />
      <GoogleConnectBanner
        connected={googleStatus.connected}
        needsReauth={googleStatus.needsReauth}
      />
      <CalendarView
        initialMonth={initialMonth}
        initialAnchorDate={initialAnchorDate}
        initialEvents={events}
      />
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
