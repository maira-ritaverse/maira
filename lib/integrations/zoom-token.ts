/**
 * Zoom 接続トークンの取得 + 自動 refresh ヘルパ
 *
 * Zoom access_token は ~ 1 時間で失効、refresh_token は ~ 24 時間。
 * Background Job が録画を取りに行く頃には access_token が切れている可能性が
 * 高いので、毎回「期限を確認 → 必要なら refresh → DB に書き戻す」する。
 *
 * 呼び出し側は service_role の supabase クライアントを渡す前提
 * (zoom_connections の RLS は本人 only だが、Webhook 経由は service_role)。
 */
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type { createServiceClient } from "@/lib/supabase/service";

import { getZoomConfig, isTokenExpired, refreshTokens } from "./zoom";

type Service = ReturnType<typeof createServiceClient>;

export type ZoomAccessContext = {
  userId: string;
  zoomUserId: string | null;
  accessToken: string;
};

/**
 * zoom_connections から user_id のトークンを取り出し、必要なら refresh して
 * 「使える access_token」を返す。
 *
 * - 期限切れなら refresh_token で更新 → 新 access/refresh を暗号化 → DB upsert
 * - refresh も失敗したら throw(Webhook 側で 401 で弾く)
 *
 * zoomUserIdLookup でクエリ条件を切り替え可能(Webhook の host_id 突合と、
 * 既に user_id を持っているケースの両方を扱うため)。
 */
export async function getZoomAccessToken(args: {
  service: Service;
  // どちらか片方を渡す
  byUserId?: string;
  byZoomUserId?: string;
}): Promise<ZoomAccessContext> {
  const { service } = args;
  const query = service
    .from("zoom_connections")
    .select(
      "user_id, zoom_user_id, encrypted_access_token, encrypted_refresh_token, token_expires_at",
    );
  const { data, error } = await (args.byUserId
    ? query.eq("user_id", args.byUserId).maybeSingle()
    : args.byZoomUserId
      ? query.eq("zoom_user_id", args.byZoomUserId).maybeSingle()
      : Promise.resolve({ data: null, error: new Error("byUserId か byZoomUserId が必要") }));
  if (error || !data) {
    throw new Error("zoom_connections 未登録");
  }
  const row = data as {
    user_id: string;
    zoom_user_id: string | null;
    encrypted_access_token: string;
    encrypted_refresh_token: string;
    token_expires_at: string | null;
  };

  // 期限内なら復号して即返す
  if (!isTokenExpired(row.token_expires_at)) {
    const access = await decryptField(row.encrypted_access_token);
    if (access) {
      return { userId: row.user_id, zoomUserId: row.zoom_user_id, accessToken: access };
    }
  }

  // refresh フロー
  const config = getZoomConfig();
  if (!config) {
    throw new Error("Zoom 設定が未登録のため refresh できません");
  }
  const refreshToken = await decryptField(row.encrypted_refresh_token);
  if (!refreshToken) {
    throw new Error("refresh_token の復号に失敗");
  }
  const fresh = await refreshTokens(config, refreshToken);
  const encAccess = await encryptField(fresh.access_token);
  const encRefresh = await encryptField(fresh.refresh_token);
  if (!encAccess || !encRefresh) {
    throw new Error("新トークンの暗号化失敗");
  }
  const expiresAt = new Date(Date.now() + fresh.expires_in * 1000).toISOString();

  const { error: upErr } = await service
    .from("zoom_connections")
    .update({
      encrypted_access_token: encAccess,
      encrypted_refresh_token: encRefresh,
      scope: fresh.scope,
      token_expires_at: expiresAt,
    })
    .eq("user_id", row.user_id);
  if (upErr) {
    // 更新失敗してもアクセス自体はできるので警告だけにとどめる
    console.warn("[zoom-token] DB update failed but token is fresh:", upErr.message);
  }

  return {
    userId: row.user_id,
    zoomUserId: row.zoom_user_id,
    accessToken: fresh.access_token,
  };
}
