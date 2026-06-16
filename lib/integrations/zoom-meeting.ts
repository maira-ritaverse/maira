/**
 * Zoom Meeting REST API ラッパ
 *
 * 個人 OAuth トークンを使って、認可ユーザ本人の Zoom アカウントに対し
 * 会議を作成 / 取得 / 更新 / 削除するための薄いラッパ。
 *
 * Maira 側の運用ルール:
 *   - settings.host_video = true / participant_video = true で開始時カメラ ON
 *   - settings.waiting_room = true(求職者に Maira ブランドの待機室を見せる)
 *   - settings.auto_recording = "cloud"(録画を自動で開始、Webhook で取込)
 *   - settings.mute_upon_entry = true(入室時ミュート、エチケット)
 *   - timezone = "Asia/Tokyo" を既定
 *
 * 上記の既定値は callsite から上書き可能。
 *
 * 認証:
 *   ・accessToken は呼び出し前に zoom-token.ts で fresh にしてから渡す
 *
 * エラー設計:
 *   ・4xx / 5xx は throw(Error.message に Zoom 応答ボディの先頭 500 字)
 *   ・呼び出し側は try/catch して API レスポンスで包む
 */

const API_BASE = "https://api.zoom.us/v2";

export type CreateZoomMeetingInput = {
  /** 会議タイトル(Zoom 側に登録される) */
  topic: string;
  /** ISO 8601 形式の開始日時(UTC でも JST でも可、Zoom 側で timezone と組み合わせて解釈) */
  startTime: string;
  /** 会議の長さ(分) */
  durationMinutes: number;
  /** 既定 Asia/Tokyo。Zoom が認識する tz データベース名(参考: https://marketplace.zoom.us/docs/api-reference/other-references/abbreviation-lists#timezones) */
  timezone?: string;
  /** 議題(会議詳細欄に出る) */
  agenda?: string;
  /** パスコード(Waiting Room を使うので必須ではないが、設定しておくとセキュア) */
  password?: string;
};

export type ZoomMeetingResponse = {
  id: number;
  uuid: string;
  host_id: string;
  topic: string;
  start_time: string;
  duration: number;
  timezone: string;
  join_url: string;
  start_url: string;
  password?: string;
  settings?: Record<string, unknown>;
};

/**
 * 会議作成リクエストのボディを組み立てる純関数。
 * テスト容易性のためロジックを分離。
 */
export function buildCreateMeetingBody(input: CreateZoomMeetingInput): Record<string, unknown> {
  return {
    topic: input.topic,
    // type=2: Scheduled meeting(日時指定の単発会議)
    type: 2,
    start_time: input.startTime,
    duration: input.durationMinutes,
    timezone: input.timezone ?? "Asia/Tokyo",
    agenda: input.agenda ?? "",
    password: input.password,
    settings: {
      host_video: true,
      participant_video: true,
      waiting_room: true,
      mute_upon_entry: true,
      // クラウド録画を自動開始 → Webhook で Maira に取込
      auto_recording: "cloud",
      // 招待を受け取った Zoom ユーザがホストの認可なしで入室できる(求職者は Zoom 未登録のことも多い)
      join_before_host: false,
      // approval_type=2: 登録不要(URL を持っていれば誰でも入れる)
      approval_type: 2,
    },
  };
}

async function zoomFetch<T>(
  accessToken: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  // DELETE / PATCH は 204 No Content を返すので JSON パースしない
  if (res.status === 204) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoom ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }

  // 一部の成功応答も空ボディの可能性がある(念のため)
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  return (await res.json()) as T;
}

/**
 * 認可ユーザ本人の Zoom に scheduled meeting を作成する。
 * 戻り値の id / join_url / start_url を DB に保存する想定。
 */
export async function createZoomMeeting(
  accessToken: string,
  input: CreateZoomMeetingInput,
): Promise<ZoomMeetingResponse> {
  const body = buildCreateMeetingBody(input);
  const result = await zoomFetch<ZoomMeetingResponse>(
    accessToken,
    "POST",
    "/users/me/meetings",
    body,
  );
  if (!result) {
    throw new Error("Zoom create meeting returned empty body");
  }
  return result;
}

/** 既存会議の詳細を取得 */
export function getZoomMeeting(
  accessToken: string,
  meetingId: string | number,
): Promise<ZoomMeetingResponse> {
  return zoomFetch<ZoomMeetingResponse>(accessToken, "GET", `/meetings/${meetingId}`).then((r) => {
    if (!r) throw new Error("Zoom get meeting returned empty body");
    return r;
  });
}

/**
 * 会議の日時 / 議題を更新する。
 * Zoom 側は変更可能フィールドが多いが、Maira では topic / start_time / duration / agenda のみ
 * 露出させる(他は UI から触らせない)。
 */
export async function updateZoomMeeting(
  accessToken: string,
  meetingId: string | number,
  patch: Partial<
    Pick<CreateZoomMeetingInput, "topic" | "startTime" | "durationMinutes" | "agenda">
  >,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.topic !== undefined) body.topic = patch.topic;
  if (patch.startTime !== undefined) body.start_time = patch.startTime;
  if (patch.durationMinutes !== undefined) body.duration = patch.durationMinutes;
  if (patch.agenda !== undefined) body.agenda = patch.agenda;
  await zoomFetch(accessToken, "PATCH", `/meetings/${meetingId}`, body);
}

/** 会議をキャンセル(=削除) */
export async function deleteZoomMeeting(
  accessToken: string,
  meetingId: string | number,
): Promise<void> {
  await zoomFetch(accessToken, "DELETE", `/meetings/${meetingId}`);
}
