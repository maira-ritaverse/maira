/**
 * line_channels DB クエリ ヘルパー
 *
 * Channel Access Token / Secret は field-encryption で 暗号化保存。
 * 取得時 は decrypt して 平文 を 返す (呼び出し側は サーバ実行 限定)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";

export type LineChannel = {
  organizationId: string;
  lineChannelId: string;
  lineBotUserId: string | null;
  webhookToken: string;
  liffId: string | null;
  linePlan: "free" | "light" | "standard" | null;
  monthlyMessageQuota: number | null;
  isActive: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LineChannelDecrypted = LineChannel & {
  channelSecret: string;
  channelAccessToken: string;
};

/**
 * 現ユーザーの 組織の LINE Channel 設定 を 取得 (Token 等 を 含まない 公開フィールド のみ)。
 */
export async function getMyLineChannel(supabase: SupabaseClient): Promise<LineChannel | null> {
  const { data, error } = await supabase
    .from("line_channels")
    .select(
      "organization_id, line_channel_id, line_bot_user_id, webhook_token, liff_id, line_plan, monthly_message_quota, is_active, last_verified_at, created_at, updated_at",
    )
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as DbLineChannelPublic);
}

/**
 * webhook_token から org の Channel を 引く 際 の 結果 型。
 *
 * C1-2 修正: is_active=false と 「そもそも 存在 しない」 を 呼び出し 側 で 区別
 * できる よう 情報 を 残す。 従来 は 両者 とも null で 帰って いた ため、 「LINE
 * 側 では 送信 して いる のに Maira 側 で 通知 が 来ない」 という 事象 の 一次
 * 切り 分け が でき ず 運用 上 の 盲点 と なって いた。
 */
export type LineChannelLookupResult =
  | { kind: "found"; channel: LineChannelDecrypted }
  | { kind: "inactive"; organizationId: string }
  | { kind: "decrypt_failed"; organizationId: string }
  | { kind: "not_found" };

/**
 * service_role キー で webhook_token から org の Channel を 取得 + Token 復号。
 * Webhook 受信時 / 送信時 に 使う。 状態 別 に 詳細 な 結果 を 返す。
 */
export async function getLineChannelByWebhookToken(
  adminSupabase: SupabaseClient,
  webhookToken: string,
): Promise<LineChannelLookupResult> {
  const { data, error } = await adminSupabase
    .from("line_channels")
    .select("*")
    .eq("webhook_token", webhookToken)
    .maybeSingle();
  if (error || !data) return { kind: "not_found" };
  const row = data as DbLineChannelFull;
  if (!row.is_active) {
    return { kind: "inactive", organizationId: row.organization_id };
  }
  const decrypted = await decryptChannel(row);
  if (!decrypted) {
    return { kind: "decrypt_failed", organizationId: row.organization_id };
  }
  return { kind: "found", channel: decrypted };
}

/**
 * service_role キー で organization_id から Channel を 取得 + Token 復号。
 * メッセージ送信時 に 使う。
 */
export async function getLineChannelByOrgId(
  adminSupabase: SupabaseClient,
  organizationId: string,
): Promise<LineChannelDecrypted | null> {
  const { data, error } = await adminSupabase
    .from("line_channels")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return await decryptChannel(data as DbLineChannelFull);
}

/**
 * LINE Channel 設定 を upsert。 Token を 暗号化保存。
 * 既存行 が あれば 上書き、 webhook_token は 維持 (URL を 変えない ため)。
 */
export async function upsertLineChannel(
  adminSupabase: SupabaseClient,
  args: {
    organizationId: string;
    lineChannelId: string;
    channelSecret: string;
    channelAccessToken: string;
    lineBotUserId?: string | null;
    linePlan?: "free" | "light" | "standard" | null;
    monthlyMessageQuota?: number | null;
    liffId?: string | null;
  },
): Promise<LineChannel | null> {
  const encryptedSecret = await encryptField(args.channelSecret);
  const encryptedAccessToken = await encryptField(args.channelAccessToken);
  if (!encryptedSecret || !encryptedAccessToken) return null;

  // 既存行 を 確認 (webhook_token 維持 のため)
  const { data: existing } = await adminSupabase
    .from("line_channels")
    .select("webhook_token")
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  const webhookToken =
    (existing as { webhook_token?: string } | null)?.webhook_token ?? generateWebhookToken();

  const payload = {
    organization_id: args.organizationId,
    line_channel_id: args.lineChannelId,
    line_bot_user_id: args.lineBotUserId ?? null,
    line_channel_secret_encrypted: encryptedSecret,
    line_channel_access_token_encrypted: encryptedAccessToken,
    webhook_token: webhookToken,
    liff_id: args.liffId ?? null,
    line_plan: args.linePlan ?? null,
    monthly_message_quota: args.monthlyMessageQuota ?? null,
    is_active: true,
    last_verified_at: new Date().toISOString(),
  };

  const { data, error } = await adminSupabase
    .from("line_channels")
    .upsert(payload, { onConflict: "organization_id" })
    .select(
      "organization_id, line_channel_id, line_bot_user_id, webhook_token, liff_id, line_plan, monthly_message_quota, is_active, last_verified_at, created_at, updated_at",
    )
    .single();
  if (error || !data) return null;
  return mapRow(data as DbLineChannelPublic);
}

/**
 * 推測困難な 32 文字 ランダム トークン を 生成 (a-z0-9)。
 */
export function generateWebhookToken(): string {
  // crypto.randomUUID() は 36 文字 (ハイフン含む)。 ハイフン除去 + 32 文字 に。
  const uuid1 = crypto.randomUUID().replace(/-/g, "");
  const uuid2 = crypto.randomUUID().replace(/-/g, "");
  return (uuid1 + uuid2).slice(0, 48); // 余裕を持って 48 文字
}

// ============================================================
// 内部ヘルパー
// ============================================================

type DbLineChannelPublic = {
  organization_id: string;
  line_channel_id: string;
  line_bot_user_id: string | null;
  webhook_token: string;
  liff_id: string | null;
  line_plan: "free" | "light" | "standard" | null;
  monthly_message_quota: number | null;
  is_active: boolean;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type DbLineChannelFull = DbLineChannelPublic & {
  line_channel_secret_encrypted: string;
  line_channel_access_token_encrypted: string;
};

function mapRow(row: DbLineChannelPublic): LineChannel {
  return {
    organizationId: row.organization_id,
    lineChannelId: row.line_channel_id,
    lineBotUserId: row.line_bot_user_id,
    webhookToken: row.webhook_token,
    liffId: row.liff_id,
    linePlan: row.line_plan,
    monthlyMessageQuota: row.monthly_message_quota,
    isActive: row.is_active,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function decryptChannel(row: DbLineChannelFull): Promise<LineChannelDecrypted | null> {
  const secret = await decryptField(row.line_channel_secret_encrypted);
  const accessToken = await decryptField(row.line_channel_access_token_encrypted);
  if (!secret || !accessToken) return null;
  return {
    ...mapRow(row),
    channelSecret: secret,
    channelAccessToken: accessToken,
  };
}
