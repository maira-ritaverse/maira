/**
 * LINE Webhook イベント の 型 (公式 仕様 の 部分集合)。
 *
 * Phase 1 で 扱う:
 *   - message (text / sticker / image / video / audio / file / location)
 *   - follow (友達追加)
 *   - unfollow (ブロック / 友達削除)
 *   - postback (Phase 3 で Quick Reply 確定 に 使用)
 *
 * 公式: https://developers.line.biz/ja/reference/messaging-api/#webhook-event-objects
 */

export type LineEventSource = {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
};

type Base = {
  type: string;
  timestamp: number;
  source: LineEventSource;
  /** redelivery 検知 (LINE 側 再送) */
  webhookEventId: string;
  deliveryContext?: { isRedelivery?: boolean };
  mode?: "active" | "standby";
};

export type LineMessageContentBase = {
  id: string;
  type: "text" | "sticker" | "image" | "video" | "audio" | "file" | "location";
};

export type LineTextMessage = LineMessageContentBase & {
  type: "text";
  text: string;
  // 言及やエモジ 情報 は Phase 1 では 無視
};

export type LineStickerMessage = LineMessageContentBase & {
  type: "sticker";
  packageId: string;
  stickerId: string;
  stickerResourceType?: string;
  keywords?: string[];
};

export type LineImageMessage = LineMessageContentBase & {
  type: "image";
  contentProvider?: { type: "line" | "external"; originalContentUrl?: string };
};

export type LineFileMessage = LineMessageContentBase & {
  type: "file";
  fileName: string;
  fileSize: number;
};

export type LineLocationMessage = LineMessageContentBase & {
  type: "location";
  title?: string;
  address?: string;
  latitude: number;
  longitude: number;
};

export type LineMessageEvent = Base & {
  type: "message";
  replyToken: string;
  message:
    | LineTextMessage
    | LineStickerMessage
    | LineImageMessage
    | LineFileMessage
    | LineLocationMessage
    | (LineMessageContentBase & { type: "video" | "audio" });
};

export type LineFollowEvent = Base & {
  type: "follow";
  replyToken: string;
};

export type LineUnfollowEvent = Base & {
  type: "unfollow";
};

export type LinePostbackEvent = Base & {
  type: "postback";
  replyToken: string;
  postback: {
    data: string;
    params?: Record<string, string>;
  };
};

export type LineWebhookEvent =
  | LineMessageEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LinePostbackEvent
  // 未対応 イベント は Base で 受けて 無視
  | (Base & {
      type:
        | "join"
        | "leave"
        | "memberJoined"
        | "memberLeft"
        | "videoPlayComplete"
        | "beacon"
        | "accountLink"
        | "things"
        | "unsend";
    });

export type LineWebhookBody = {
  destination: string;
  events: LineWebhookEvent[];
};
