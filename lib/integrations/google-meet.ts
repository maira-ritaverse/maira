/**
 * Google Calendar API 経由で Meet 同梱イベントを作成するラッパ
 *
 * Meet 単体には会議リンク発行 API がない。
 * Calendar イベントに `conferenceData.createRequest` を載せると、Google が
 * Meet リンクを自動採番してくれる(conferenceDataVersion=1 必須)。
 *
 * 認証:
 *   ・accessToken は呼び出し前に google-token.ts で fresh にしてから渡す
 *
 * エラー設計:
 *   ・4xx/5xx は throw(message に応答ボディの先頭 500 字)
 */

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export type CreateGoogleMeetInput = {
  summary: string;
  description?: string;
  /** ISO 8601(timezone 情報を含む) */
  startsAt: string;
  endsAt: string;
  /** 例: "Asia/Tokyo" */
  timezone?: string;
  /** 招待者メール(任意。エージェント側から見ると求職者を入れる) */
  attendees?: Array<{ email: string; name?: string }>;
};

export type GoogleEventResponse = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  htmlLink: string;
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: Array<{
      entryPointType: "video" | "phone" | "more" | "sip";
      uri: string;
      label?: string;
      pin?: string;
    }>;
  };
  hangoutLink?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
};

/**
 * Calendar イベント作成のリクエストボディを組み立てる純関数。
 * テスト容易性のため分離。
 */
export function buildCreateEventBody(input: CreateGoogleMeetInput): Record<string, unknown> {
  const tz = input.timezone ?? "Asia/Tokyo";
  return {
    summary: input.summary,
    description: input.description ?? "",
    start: { dateTime: input.startsAt, timeZone: tz },
    end: { dateTime: input.endsAt, timeZone: tz },
    attendees: (input.attendees ?? []).map((a) => ({ email: a.email, displayName: a.name })),
    // Meet を自動採番させる呪文
    conferenceData: {
      createRequest: {
        // requestId はクライアントが採番する任意の文字列(再試行を冪等にするため)
        // 同じ requestId で再リクエストすると Google は前回と同じ会議を返す。
        // 完全な一意性が欲しいので "{starts}-{summary 先頭 12 字}" を使う想定。
        requestId: `${input.startsAt}-${input.summary.slice(0, 12)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
    // 招待者には Google からメール通知を送らない(Maira の独自メールと二重になるため)
    // ※ Phase 2 のメール送信で同じ求職者にメールを送るので、ここを true にすると二重通知
    // ※ true にしたいときは Calendar UI に従う運用にする
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
  };
}

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
 * Primary カレンダーに Meet 同梱イベントを作成して、Meet URL を抽出して返す。
 *
 * sendUpdates=none は「Google から招待者にメールを送らない」モード。
 * Maira 側でメールを送るので二重通知を防ぐ。
 */
export async function createGoogleMeetEvent(
  accessToken: string,
  input: CreateGoogleMeetInput,
): Promise<{ event: GoogleEventResponse; meetUrl: string }> {
  const body = buildCreateEventBody(input);
  const result = await gcalFetch<GoogleEventResponse>(
    accessToken,
    "POST",
    "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none",
    body,
  );
  if (!result) {
    throw new Error("Google Calendar create event returned empty body");
  }
  // hangoutLink もしくは entryPoints の video を採用
  const meetUrl =
    result.hangoutLink ??
    result.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
    null;
  if (!meetUrl) {
    throw new Error("Google Calendar response did not include a Meet URL");
  }
  return { event: result, meetUrl };
}

/** イベントを削除(キャンセル) */
export async function deleteGoogleEvent(accessToken: string, eventId: string): Promise<void> {
  await gcalFetch(
    accessToken,
    "DELETE",
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
  );
}

/** イベント更新(再スケジュール) */
export async function updateGoogleEvent(
  accessToken: string,
  eventId: string,
  patch: Partial<
    Pick<CreateGoogleMeetInput, "summary" | "description" | "startsAt" | "endsAt" | "timezone">
  >,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.startsAt !== undefined) {
    body.start = { dateTime: patch.startsAt, timeZone: patch.timezone ?? "Asia/Tokyo" };
  }
  if (patch.endsAt !== undefined) {
    body.end = { dateTime: patch.endsAt, timeZone: patch.timezone ?? "Asia/Tokyo" };
  }
  await gcalFetch(
    accessToken,
    "PATCH",
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    body,
  );
}
