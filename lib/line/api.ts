/**
 * LINE Messaging API クライアント (raw fetch)
 *
 * 設計判断:
 *   ・@line/bot-sdk は 入れず raw fetch で 実装
 *     (依存追加 を 避ける、 Edge runtime でも 動く)
 *   ・各 関数 は Channel Access Token を 第1引数 で 受ける
 *     (org ごとに 異なる ため グローバル に 持てない)
 *   ・エラー は throw せず Result 型 で 返す (呼出側で 状態保存)
 *
 * 公式 ドキュメント:
 *   https://developers.line.biz/ja/reference/messaging-api/
 */

const LINE_API_BASE = "https://api.line.me/v2";
const LINE_API_DATA_BASE = "https://api-data.line.me/v2";

type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/**
 * Bot 自身 の 情報 を 取得。 Token の 有効性 確認 に 使う。
 * GET /v2/bot/info
 */
export type BotInfo = {
  userId: string;
  basicId: string;
  premiumId: string | null;
  displayName: string;
  pictureUrl: string | null;
  chatMode: "chat" | "bot";
  markAsReadMode: "auto" | "manual";
};

export async function getBotInfo(accessToken: string): Promise<Result<BotInfo>> {
  try {
    const res = await fetch(`${LINE_API_BASE}/bot/info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) || `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      userId: string;
      basicId: string;
      premiumId?: string | null;
      displayName: string;
      pictureUrl?: string | null;
      chatMode: "chat" | "bot";
      markAsReadMode: "auto" | "manual";
    };
    return {
      ok: true,
      data: {
        userId: json.userId,
        basicId: json.basicId,
        premiumId: json.premiumId ?? null,
        displayName: json.displayName,
        pictureUrl: json.pictureUrl ?? null,
        chatMode: json.chatMode,
        markAsReadMode: json.markAsReadMode,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * LINE ユーザー プロファイル を 取得 (Bot の 友達 のみ)。
 * GET /v2/bot/profile/{userId}
 */
export type LineUserProfile = {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
  statusMessage: string | null;
  language: string | null;
};

export async function getUserProfile(
  accessToken: string,
  lineUserId: string,
): Promise<Result<LineUserProfile>> {
  try {
    const res = await fetch(`${LINE_API_BASE}/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) || `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      userId: string;
      displayName: string;
      pictureUrl?: string | null;
      statusMessage?: string | null;
      language?: string | null;
    };
    return {
      ok: true,
      data: {
        userId: json.userId,
        displayName: json.displayName,
        pictureUrl: json.pictureUrl ?? null,
        statusMessage: json.statusMessage ?? null,
        language: json.language ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * メッセージ コンテンツ を ダウンロード (画像 / 動画 / 音声 / ファイル)。
 * GET /v2/bot/message/{messageId}/content
 *
 * 注意:LINE 側 仕様 で コンテンツ は アップロードから 1 週間 で 失効。
 * Webhook 受信後 すぐに ダウンロード する 必要 が ある。
 */
export type MessageContent = {
  contentType: string;
  size: number;
  data: ArrayBuffer;
};

export async function getMessageContent(
  accessToken: string,
  messageId: string,
): Promise<Result<MessageContent>> {
  try {
    const res = await fetch(
      `${LINE_API_DATA_BASE}/bot/message/${encodeURIComponent(messageId)}/content`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) || `HTTP ${res.status}` };
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const data = await res.arrayBuffer();
    return {
      ok: true,
      data: { contentType, size: data.byteLength, data },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * Webhook URL を LINE 側 に 設定 (Channel に 紐付け)。
 * PUT /v2/bot/channel/webhook/endpoint
 *
 * これで LINE Developers コンソール の 「Webhook URL」 欄 を 手動 コピペ する 必要が なくなる。
 */
export async function setWebhookEndpoint(
  accessToken: string,
  endpoint: string,
): Promise<Result<unknown>> {
  try {
    const res = await fetch(`${LINE_API_BASE}/bot/channel/webhook/endpoint`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) };
    }
    return { ok: true, data: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * 現在 LINE 側 に 登録 されて いる Webhook URL を 取得。
 * GET /v2/bot/channel/webhook/endpoint
 */
export type WebhookEndpointInfo = {
  endpoint: string;
  active: boolean;
};

export async function getWebhookEndpoint(
  accessToken: string,
): Promise<Result<WebhookEndpointInfo>> {
  try {
    const res = await fetch(`${LINE_API_BASE}/bot/channel/webhook/endpoint`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) };
    }
    const json = (await res.json()) as { endpoint?: string; active?: boolean };
    return {
      ok: true,
      data: {
        endpoint: json.endpoint ?? "",
        active: json.active ?? false,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * Webhook 疎通 テスト (LINE → Maira)。 LINE が テスト event を 投げる。
 * POST /v2/bot/channel/webhook/test
 */
export type WebhookTestResult = {
  success: boolean;
  timestamp: number;
  statusCode: number;
  reason: string;
  detail: string;
};

export async function testWebhookEndpoint(accessToken: string): Promise<Result<WebhookTestResult>> {
  try {
    const res = await fetch(`${LINE_API_BASE}/bot/channel/webhook/test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) };
    }
    const json = (await res.json()) as WebhookTestResult;
    return { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * LIFF アプリ を 自動 作成。
 * POST /liff/v1/apps
 *
 * 引数 endpoint = LIFF Endpoint URL (= Maira 側 /liff/{orgId})。
 * 戻り値 の liffId を line_channels.liff_id に 保存 して すぐ 使える。
 */
export type LiffAppCreated = {
  liffId: string;
};

export async function createLiffApp(
  accessToken: string,
  endpointUrl: string,
): Promise<Result<LiffAppCreated>> {
  try {
    const res = await fetch("https://api.line.me/liff/v1/apps", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        view: {
          type: "full",
          url: endpointUrl,
        },
        features: {
          ble: false,
          qrCode: false,
        },
        scope: ["profile", "openid"],
        botPrompt: "normal",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) };
    }
    const json = (await res.json()) as { liffId?: string };
    if (!json.liffId) {
      return { ok: false, status: 0, message: "no_liff_id_in_response" };
    }
    return { ok: true, data: { liffId: json.liffId } };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * Rich Menu を デフォルト として 設定 (全 未個別設定 ユーザー に 適用)。
 * POST /v2/bot/user/all/richmenu/{richMenuId}
 */
export async function setDefaultRichMenu(
  accessToken: string,
  richMenuId: string,
): Promise<Result<unknown>> {
  return await postJson(
    `${LINE_API_BASE}/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`,
    accessToken,
    {},
  );
}

/**
 * デフォルト Rich Menu を 解除 (全ユーザー 一括)。
 */
export async function unsetDefaultRichMenu(accessToken: string): Promise<Result<unknown>> {
  try {
    const res = await fetch(`${LINE_API_BASE}/bot/user/all/richmenu`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) };
    }
    return { ok: true, data: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * 特定 ユーザー に Rich Menu を 個別 設定 (デフォルトを 上書き)。
 * POST /v2/bot/user/{userId}/richmenu/{richMenuId}
 */
export async function linkRichMenuToUser(
  accessToken: string,
  lineUserId: string,
  richMenuId: string,
): Promise<Result<unknown>> {
  try {
    const res = await fetch(
      `${LINE_API_BASE}/bot/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(richMenuId)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) };
    }
    return { ok: true, data: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * 特定 ユーザー の 個別 Rich Menu 設定 を 解除 (デフォルトに 戻す)。
 */
export async function unlinkRichMenuFromUser(
  accessToken: string,
  lineUserId: string,
): Promise<Result<unknown>> {
  try {
    const res = await fetch(
      `${LINE_API_BASE}/bot/user/${encodeURIComponent(lineUserId)}/richmenu`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: body.slice(0, 500) };
    }
    return { ok: true, data: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * Reply Message (受信から 30 秒以内、 無料)
 * POST /v2/bot/message/reply
 */
export async function replyMessage(
  accessToken: string,
  replyToken: string,
  messages: LineMessage[],
): Promise<Result<{ sentMessages?: Array<{ id: string }> }>> {
  return await postJson(`${LINE_API_BASE}/bot/message/reply`, accessToken, {
    replyToken,
    messages,
  });
}

/**
 * Push Message (主動配信、 1 通あたり 課金通数 1)
 * POST /v2/bot/message/push
 */
export async function pushMessage(
  accessToken: string,
  to: string,
  messages: LineMessage[],
): Promise<Result<{ sentMessages?: Array<{ id: string }> }>> {
  return await postJson(`${LINE_API_BASE}/bot/message/push`, accessToken, {
    to,
    messages,
  });
}

/**
 * Multicast Message (1 回 で 500 人 まで、 各 受信者 = 課金通数 1)。
 * POST /v2/bot/message/multicast
 */
export async function multicastMessage(
  accessToken: string,
  toUserIds: string[],
  messages: LineMessage[],
): Promise<Result<unknown>> {
  if (toUserIds.length === 0 || toUserIds.length > 500) {
    return { ok: false, status: 0, message: "to must be 1-500 users" };
  }
  return await postJson(`${LINE_API_BASE}/bot/message/multicast`, accessToken, {
    to: toUserIds,
    messages,
  });
}

/**
 * 共通 POST + Auth + JSON
 */
async function postJson<T>(url: string, accessToken: string, body: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        message: bodyText.slice(0, 500) || `HTTP ${res.status}`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * Quick Reply (送信メッセージ に 添付 可能、 受信者 LINE で ボタン 表示)
 * 公式: https://developers.line.biz/ja/docs/messaging-api/using-quick-reply/
 */
export type LineQuickReplyItem = {
  type: "action";
  imageUrl?: string;
  action:
    | { type: "message"; label: string; text: string }
    | { type: "postback"; label: string; data: string; displayText?: string }
    | { type: "uri"; label: string; uri: string };
};

export type LineQuickReply = {
  items: LineQuickReplyItem[]; // 最大 13 個
};

/**
 * LINE Message 型 (送信用 の 部分集合)。
 * Phase 1: text / sticker。 Phase 2: flex / quickReply 追加。
 */
export type LineMessage =
  | { type: "text"; text: string; quickReply?: LineQuickReply }
  | { type: "sticker"; packageId: string; stickerId: string; quickReply?: LineQuickReply }
  | { type: "flex"; altText: string; contents: unknown; quickReply?: LineQuickReply }
  | {
      type: "image";
      /** HTTPS 必須、 最大 10 MB、 JPEG/PNG */
      originalContentUrl: string;
      /** HTTPS 必須、 最大 1 MB (シンプル化 で original と 同じ URL も OK) */
      previewImageUrl: string;
      quickReply?: LineQuickReply;
    };
