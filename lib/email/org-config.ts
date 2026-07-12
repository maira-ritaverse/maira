/**
 * 組織の Resend 送信設定(BYO)を取得するヘルパ。
 *
 * 各組織が持ち込んだ Resend API キーは AES-256-GCM 暗号化されているので、
 * 送信時にサーバー側で復号する必要がある。
 *
 * 未設定なら null を返し、呼び出し側は env の値にフォールバックする。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField } from "@/lib/crypto/field-encryption";

export type OrgEmailConfig = {
  apiKey: string | null;
  from: string | null;
};

/**
 * organization の DB から Resend 設定を読んで復号する。
 * 復号失敗は null 扱い(env にフォールバック)。
 */
export async function getOrgEmailConfig(
  admin: SupabaseClient,
  organizationId: string,
): Promise<OrgEmailConfig> {
  const { data } = await admin
    .from("organizations")
    .select("resend_api_key_encrypted, email_from")
    .eq("id", organizationId)
    .maybeSingle();

  const row = data as {
    resend_api_key_encrypted: string | null;
    email_from: string | null;
  } | null;

  let apiKey: string | null = null;
  if (row?.resend_api_key_encrypted) {
    try {
      apiKey = (await decryptField(row.resend_api_key_encrypted)) ?? null;
    } catch {
      // 復号失敗(鍵ローテーション後 or 破損)は fallback とみなす
      apiKey = null;
    }
  }

  return {
    apiKey,
    from: row?.email_from ?? null,
  };
}
