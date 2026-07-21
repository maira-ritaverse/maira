/**
 * Google Calendar Events API の汎用ラッパ
 *
 * 用途:Myaira カレンダー画面で「個人 Google カレンダーをそのまま編集する」UI。
 * google-meet.ts は「Meet 同梱イベント作成」に特化しているため別ファイル。
 *
 * 認証:
 *   accessToken は呼び出し前に google-token.ts で fresh にしてから渡す。
 *
 * エラー設計:
 *   4xx/5xx は throw(message に応答ボディの先頭 500 字)
 */

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

/** Google Events API から返ってくる Event の最小型 */
export type GoogleCalendarEvent = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink: string;
  // 開始 / 終了は dateTime(時刻付き) or date(終日)で来る
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  hangoutLink?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  // 主催者(自分の primary なら self=true)
  organizer?: { email?: string; displayName?: string; self?: boolean };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
  };
};

export type ListEventsOptions = {
  /** ISO 8601。timeMin <= start のイベントを取得 */
  timeMin: string;
  timeMax: string;
  /** 既定 250(API の上限) */
  maxResults?: number;
  /** 単発予定の重複を抑えるため singleEvents=true で繰り返しを展開 */
  singleEvents?: boolean;
};

async function gcalFetch<T>(
  accessToken: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T | null> {
  const res = await fetch(`${CAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google Calendar ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`,
    );
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  return (await res.json()) as T;
}

/**
 * Primary カレンダーのイベントを期間指定で一覧取得する。
 *
 * singleEvents=true は「定期予定の親 1 件」ではなく「展開後の個別予定」を返す設定。
 * カレンダー表示には展開後のほうが直感的なので既定で有効化。
 */
export async function listGoogleCalendarEvents(
  accessToken: string,
  opts: ListEventsOptions,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: opts.singleEvents === false ? "false" : "true",
    orderBy: "startTime",
    maxResults: String(opts.maxResults ?? 250),
  });
  const result = await gcalFetch<{ items?: GoogleCalendarEvent[] }>(
    accessToken,
    "GET",
    `/calendars/primary/events?${params.toString()}`,
  );
  return result?.items ?? [];
}

/** 1 件取得 */
export function getGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
): Promise<GoogleCalendarEvent | null> {
  return gcalFetch<GoogleCalendarEvent>(
    accessToken,
    "GET",
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
  );
}

export type CreateEventInput = {
  summary: string;
  description?: string;
  location?: string;
  /** ISO 8601(timezone 情報を含む)。終日にしたいときは all_day=true + date のみ */
  startsAt: string;
  endsAt: string;
  /** 既定 "Asia/Tokyo" */
  timezone?: string;
  /** 招待先 */
  attendees?: Array<{ email: string; name?: string }>;
};

/** イベント作成(Conference 自動採番なし、通常の予定) */
export function createGoogleCalendarEvent(
  accessToken: string,
  input: CreateEventInput,
): Promise<GoogleCalendarEvent | null> {
  const tz = input.timezone ?? "Asia/Tokyo";
  const body = {
    summary: input.summary,
    description: input.description ?? "",
    location: input.location ?? "",
    start: { dateTime: input.startsAt, timeZone: tz },
    end: { dateTime: input.endsAt, timeZone: tz },
    attendees: (input.attendees ?? []).map((a) => ({ email: a.email, displayName: a.name })),
  };
  return gcalFetch<GoogleCalendarEvent>(
    accessToken,
    "POST",
    "/calendars/primary/events?sendUpdates=none",
    body,
  );
}

/** 既存イベントの一部フィールドだけ更新(PATCH) */
export function updateGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
  patch: Partial<CreateEventInput>,
): Promise<GoogleCalendarEvent | null> {
  const tz = patch.timezone ?? "Asia/Tokyo";
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.startsAt !== undefined) body.start = { dateTime: patch.startsAt, timeZone: tz };
  if (patch.endsAt !== undefined) body.end = { dateTime: patch.endsAt, timeZone: tz };
  if (patch.attendees !== undefined) {
    body.attendees = patch.attendees.map((a) => ({ email: a.email, displayName: a.name }));
  }
  return gcalFetch<GoogleCalendarEvent>(
    accessToken,
    "PATCH",
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    body,
  );
}

/** 削除 */
export function deleteGoogleCalendarEvent(accessToken: string, eventId: string): Promise<null> {
  return gcalFetch<null>(
    accessToken,
    "DELETE",
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
  ) as Promise<null>;
}

/**
 * Myaira カレンダーの CalendarEvent 形に変換する純関数。
 * 表示用のため最小限のフィールドだけ取り出す。
 */
export function toCalendarEvent(ev: GoogleCalendarEvent): {
  id: string;
  externalEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  dateKey: string;
  joinUrl: string | null;
  organizerName: string;
} | null {
  // status=cancelled は表示しない
  if (ev.status === "cancelled") return null;
  const startsAt = ev.start.dateTime ?? (ev.start.date ? `${ev.start.date}T00:00:00` : null);
  const endsAt = ev.end.dateTime ?? (ev.end.date ? `${ev.end.date}T23:59:59` : null);
  if (!startsAt || !endsAt) return null;
  const dateKey = startsAt.slice(0, 10);
  const joinUrl =
    ev.hangoutLink ??
    ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
    null;
  const organizerName = ev.organizer?.displayName ?? ev.organizer?.email ?? "";
  return {
    id: `external_google:${ev.id}`,
    externalEventId: ev.id,
    title: ev.summary ?? "(タイトル無し)",
    startsAt,
    endsAt,
    dateKey,
    joinUrl,
    organizerName,
  };
}
