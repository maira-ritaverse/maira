/**
 * 外部連携(Zoom / Google)の接続状態 + 有効機能を 1 か所で判定する
 *
 * 設定画面 / ダッシュボード / 各 API ルートで「何が使えるか」を
 * 同じ基準で出すための薄いラッパ。スコープ判定は scope 文字列か
 * scopes_granted 配列のどちらかで判定する(callback で両方埋まる)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasCalendarEventsScope, hasDriveReadonlyScope } from "@/lib/integrations/google";
import { hasMeetingWriteScope } from "@/lib/integrations/zoom";

export type GoogleConnectionStatus = {
  connected: boolean;
  email: string | null;
  /** カレンダー連携(events 作成・編集が可能) */
  calendarEnabled: boolean;
  /** Drive 経由の Meet 録画自動取込が可能 */
  driveEnabled: boolean;
  /** 必要なスコープが 1 つでも欠けている = 再接続を促す */
  needsReauth: boolean;
};

export type ZoomConnectionStatus = {
  connected: boolean;
  accountId: string | null;
  /** Maira から Zoom 会議の作成・編集が可能 */
  meetingWriteEnabled: boolean;
  needsReauth: boolean;
};

function hasScope(
  scopeText: string | null,
  granted: string[] | null,
  predicate: (s: string | null) => boolean,
  exactScope: string,
): boolean {
  if (predicate(scopeText)) return true;
  return (granted ?? []).includes(exactScope);
}

export async function getGoogleConnectionStatus(
  client: SupabaseClient,
  userId: string,
): Promise<GoogleConnectionStatus> {
  const { data } = await client
    .from("google_connections")
    .select("google_email, scope, scopes_granted")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    return {
      connected: false,
      email: null,
      calendarEnabled: false,
      driveEnabled: false,
      needsReauth: false,
    };
  }
  const row = data as {
    google_email: string | null;
    scope: string | null;
    scopes_granted: string[] | null;
  };
  const calendarEnabled = hasScope(
    row.scope,
    row.scopes_granted,
    hasCalendarEventsScope,
    "https://www.googleapis.com/auth/calendar.events",
  );
  // drive.readonly は 撤去済(2026-06-19、Google Restricted scope CASA 監査 回避のため)。
  // 既存接続は そのまま 動く(scope に drive.readonly が 含まれて いても 害は ない)。
  // needsReauth は calendar.events だけ で 判断する。
  const driveEnabled = hasScope(
    row.scope,
    row.scopes_granted,
    hasDriveReadonlyScope,
    "https://www.googleapis.com/auth/drive.readonly",
  );
  return {
    connected: true,
    email: row.google_email,
    calendarEnabled,
    driveEnabled,
    needsReauth: !calendarEnabled,
  };
}

export async function getZoomConnectionStatus(
  client: SupabaseClient,
  userId: string,
): Promise<ZoomConnectionStatus> {
  const { data } = await client
    .from("zoom_connections")
    .select("zoom_account_id, scope, scopes_granted")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    return {
      connected: false,
      accountId: null,
      meetingWriteEnabled: false,
      needsReauth: false,
    };
  }
  const row = data as {
    zoom_account_id: string | null;
    scope: string | null;
    scopes_granted: string[] | null;
  };
  // Granular(meeting:write:meeting)優先、旧 Classic(meeting:write)も受け入れる
  const meetingWriteEnabled =
    hasScope(row.scope, row.scopes_granted, hasMeetingWriteScope, "meeting:write:meeting") ||
    hasScope(row.scope, row.scopes_granted, hasMeetingWriteScope, "meeting:write");
  return {
    connected: true,
    accountId: row.zoom_account_id,
    meetingWriteEnabled,
    needsReauth: !meetingWriteEnabled,
  };
}
