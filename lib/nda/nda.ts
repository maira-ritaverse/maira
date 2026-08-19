/**
 * NDA(秘密保持契約)同意状態のヘルパ(組織単位)。
 *
 * privacy policy(lib/privacy/policy.ts)の per-user 方式を per-organization に置き換えたもの。
 *   - organizations.nda_accepted_at / nda_version / nda_signer_name に記録
 *   - バージョンが上がると次回利用時に再同意が必要(needsToAcceptNda)
 *   - 記録・判定は組織単位。署名は組織の管理者が代表して行う
 */

import { createClient } from "@/lib/supabase/server";
import { CURRENT_NDA_VERSION } from "./nda-content";

export type NdaAcceptance = {
  acceptedAt: string | null;
  version: string | null;
  signerName: string | null;
  /**
   * クエリ自体が成功したか。false = カラム不在(マイグレーション未適用)や一時障害。
   * この場合は needsToAcceptNda が false を返し、ゲートを出さない(fail-open)。
   * fail-closed にすると障害時に /agency 全画面がロックアウトされるため。
   */
  queryOk: boolean;
};

/** organizations から NDA 同意情報を取得。 */
export async function getOrgNdaAcceptance(organizationId: string): Promise<NdaAcceptance> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("nda_accepted_at, nda_version, nda_signer_name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) {
    // カラム不在 / 一時障害。fail-open でゲートを出さない(ロックアウト回避)。
    return { acceptedAt: null, version: null, signerName: null, queryOk: false };
  }
  const row = data as {
    nda_accepted_at: string | null;
    nda_version: string | null;
    nda_signer_name: string | null;
  } | null;
  return {
    acceptedAt: row?.nda_accepted_at ?? null,
    version: row?.nda_version ?? null,
    signerName: row?.nda_signer_name ?? null,
    queryOk: true,
  };
}

/**
 * NDA 同意モーダルを出すべきか:
 *   - クエリ失敗時(queryOk=false)は出さない(fail-open)
 *   - 未同意(acceptedAt = null)
 *   - 古いバージョン(version != CURRENT_NDA_VERSION)
 */
export function needsToAcceptNda(a: NdaAcceptance): boolean {
  if (!a.queryOk) return false;
  if (!a.acceptedAt) return true;
  return a.version !== CURRENT_NDA_VERSION;
}
