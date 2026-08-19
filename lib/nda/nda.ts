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
};

/** organizations から NDA 同意情報を取得。 */
export async function getOrgNdaAcceptance(organizationId: string): Promise<NdaAcceptance> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("nda_accepted_at, nda_version, nda_signer_name")
    .eq("id", organizationId)
    .maybeSingle();
  const row = data as {
    nda_accepted_at: string | null;
    nda_version: string | null;
    nda_signer_name: string | null;
  } | null;
  return {
    acceptedAt: row?.nda_accepted_at ?? null,
    version: row?.nda_version ?? null,
    signerName: row?.nda_signer_name ?? null,
  };
}

/**
 * NDA 同意モーダルを出すべきか:
 *   - 未同意(acceptedAt = null)
 *   - 古いバージョン(version != CURRENT_NDA_VERSION)
 */
export function needsToAcceptNda(a: NdaAcceptance): boolean {
  if (!a.acceptedAt) return true;
  return a.version !== CURRENT_NDA_VERSION;
}
