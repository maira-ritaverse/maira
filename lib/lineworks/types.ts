/**
 * LINE WORKS 連携の型定義。
 *
 * DB(lineworks_channels)は snake_case。ここでは復号済みの camelCase 型と、
 * 機密を含まない公開型(UI 表示用)を分ける。
 * 仕様: docs/line-works-integration-design.md
 */

/** 復号済みの LINE WORKS 接続設定(サーバ内でのみ扱う。機密を含む)。 */
export type LineworksChannel = {
  organizationId: string;
  domainId: string | null;
  clientId: string;
  serviceAccount: string;
  botId: string | null;
  // 復号済み機密(ブラウザには渡さない)
  clientSecret: string;
  privateKey: string;
  botSecret: string | null;
  scopes: string;
  webhookToken: string;
  notifyEnabled: boolean;
  shareChannelId: string | null;
  calendarSyncEnabled: boolean;
  candidateChannelEnabled: boolean;
  isActive: boolean;
  lastVerifiedAt: string | null;
};

/** UI 表示用(機密を除いた公開情報のみ)。 */
export type LineworksChannelPublic = {
  organizationId: string;
  domainId: string | null;
  clientId: string;
  serviceAccount: string;
  botId: string | null;
  scopes: string;
  webhookToken: string;
  notifyEnabled: boolean;
  shareChannelId: string | null;
  calendarSyncEnabled: boolean;
  candidateChannelEnabled: boolean;
  isActive: boolean;
  lastVerifiedAt: string | null;
};

/** 接続設定の保存(新規・更新共通)入力。機密は平文で受け取り、queries 層で暗号化する。 */
export type UpsertLineworksChannelInput = {
  organizationId: string;
  domainId?: string | null;
  clientId: string;
  serviceAccount: string;
  botId?: string | null;
  clientSecret: string;
  privateKey: string;
  botSecret?: string | null;
  scopes?: string;
  shareChannelId?: string | null;
  notifyEnabled?: boolean;
  calendarSyncEnabled?: boolean;
};

/**
 * webhook_token → 組織 の解決結果(判別可能ユニオン)。
 * 状態別に 401/500 とログを分岐できるよう、既存 LINE(LineChannelLookupResult)に倣う。
 */
export type LineworksChannelLookupResult =
  | { status: "found"; channel: LineworksChannel }
  | { status: "inactive" }
  | { status: "decrypt_failed" }
  | { status: "not_found" };
