/**
 * LINE WORKS 接続設定(lineworks_channels)の暗号化 upsert / 復号取得。
 *
 * 既存 lib/line/queries.ts と同じ流儀:
 *   ・機密(client_secret / private_key / bot_secret)は encryptField で暗号化保存
 *   ・取得時に decryptField で復号し、平文の資格情報を返す(サーバ内のみ)
 *   ・書き込みは service_role(createServiceClient)経由(RLS は SELECT のみ開放)
 * 仕様: docs/line-works-integration-design.md
 */
import { randomBytes } from "node:crypto";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type { createServiceClient } from "@/lib/supabase/service";

import type {
  LineworksChannel,
  LineworksChannelLookupResult,
  UpsertLineworksChannelInput,
} from "./types";

type Service = ReturnType<typeof createServiceClient>;

const SELECT_COLUMNS =
  "organization_id, domain_id, client_id, service_account, bot_id, " +
  "client_secret_encrypted, private_key_encrypted, bot_secret_encrypted, " +
  "scopes, webhook_token, notify_enabled, share_channel_id, " +
  "calendar_sync_enabled, candidate_channel_enabled, is_active, last_verified_at";

type LineworksChannelRow = {
  organization_id: string;
  domain_id: string | null;
  client_id: string;
  service_account: string;
  bot_id: string | null;
  client_secret_encrypted: string;
  private_key_encrypted: string;
  bot_secret_encrypted: string | null;
  scopes: string;
  webhook_token: string;
  notify_enabled: boolean;
  share_channel_id: string | null;
  calendar_sync_enabled: boolean;
  candidate_channel_enabled: boolean;
  is_active: boolean;
  last_verified_at: string | null;
};

/** Webhook URL に埋める推測困難トークン(32 文字)。漏洩時はローテーション。 */
function newWebhookToken(): string {
  return randomBytes(24).toString("base64url");
}

/** 行を復号して LineworksChannel に変換。必須機密が復号できなければ null。 */
async function decryptChannel(row: LineworksChannelRow): Promise<LineworksChannel | null> {
  const [clientSecret, privateKey, botSecret] = await Promise.all([
    decryptField(row.client_secret_encrypted),
    decryptField(row.private_key_encrypted),
    decryptField(row.bot_secret_encrypted),
  ]);
  // client_secret / private_key はトークン発行に必須。復号失敗は fail-closed。
  if (!clientSecret || !privateKey) return null;
  return {
    organizationId: row.organization_id,
    domainId: row.domain_id,
    clientId: row.client_id,
    serviceAccount: row.service_account,
    botId: row.bot_id,
    clientSecret,
    privateKey,
    botSecret: botSecret ?? null,
    scopes: row.scopes,
    webhookToken: row.webhook_token,
    notifyEnabled: row.notify_enabled,
    shareChannelId: row.share_channel_id,
    calendarSyncEnabled: row.calendar_sync_enabled,
    candidateChannelEnabled: row.candidate_channel_enabled,
    isActive: row.is_active,
    lastVerifiedAt: row.last_verified_at,
  };
}

/** org の LINE WORKS 接続を復号込みで取得(送信・トークン発行に使う)。 */
export async function getLineworksChannelByOrgId(
  service: Service,
  organizationId: string,
): Promise<LineworksChannel | null> {
  const { data, error } = await service
    .from("lineworks_channels")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return decryptChannel(data as unknown as LineworksChannelRow);
}

/** Webhook トークンから org を解決(Bot Callback 用)。状態別の判別可能ユニオンで返す。 */
export async function getLineworksChannelByWebhookToken(
  service: Service,
  webhookToken: string,
): Promise<LineworksChannelLookupResult> {
  const { data, error } = await service
    .from("lineworks_channels")
    .select(SELECT_COLUMNS)
    .eq("webhook_token", webhookToken)
    .maybeSingle();
  if (error || !data) return { status: "not_found" };
  const row = data as unknown as LineworksChannelRow;
  if (!row.is_active) return { status: "inactive" };
  const channel = await decryptChannel(row);
  if (!channel) return { status: "decrypt_failed" };
  return { status: "found", channel };
}

/** 接続設定を暗号化して upsert。webhook_token は既存を維持し、無ければ生成する。 */
export async function upsertLineworksChannel(
  service: Service,
  input: UpsertLineworksChannelInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [clientSecretEnc, privateKeyEnc, botSecretEnc] = await Promise.all([
    encryptField(input.clientSecret),
    encryptField(input.privateKey),
    input.botSecret ? encryptField(input.botSecret) : Promise.resolve(null),
  ]);
  if (!clientSecretEnc || !privateKeyEnc) {
    return { ok: false, error: "資格情報の暗号化に失敗しました" };
  }

  // 既存の webhook_token を維持(URL を安定させる)。無ければ新規発行。
  const { data: existing } = await service
    .from("lineworks_channels")
    .select("webhook_token")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const webhookToken =
    (existing as { webhook_token: string } | null)?.webhook_token ?? newWebhookToken();

  const record: Record<string, unknown> = {
    organization_id: input.organizationId,
    domain_id: input.domainId ?? null,
    client_id: input.clientId,
    service_account: input.serviceAccount,
    bot_id: input.botId ?? null,
    client_secret_encrypted: clientSecretEnc,
    private_key_encrypted: privateKeyEnc,
    webhook_token: webhookToken,
    // 接続情報を差し替えたらキャッシュ済みトークンは無効化する
    access_token_encrypted: null,
    token_expires_at: null,
  };
  if (botSecretEnc !== null) record.bot_secret_encrypted = botSecretEnc;
  if (input.scopes) record.scopes = input.scopes;
  if (input.shareChannelId !== undefined) record.share_channel_id = input.shareChannelId;
  if (input.notifyEnabled !== undefined) record.notify_enabled = input.notifyEnabled;
  if (input.calendarSyncEnabled !== undefined) {
    record.calendar_sync_enabled = input.calendarSyncEnabled;
  }

  const { error } = await service
    .from("lineworks_channels")
    .upsert(record, { onConflict: "organization_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
