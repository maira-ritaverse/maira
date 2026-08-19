/**
 * 利用規約の同意状態のヘルパ(組織単位)。
 *
 * NDA(lib/nda/nda.ts)と同型。organizations.terms_* に記録し、バージョンが
 * 上がると次回利用時に再同意が必要(needsToAcceptTerms)。署名は組織の管理者が
 * 代表して行う。NDA と同じ複合ゲート(components/features/consent)で同時に取得する。
 */

import { createClient } from "@/lib/supabase/server";

import { CURRENT_TERMS_VERSION } from "./terms-content";

export type TermsAcceptance = {
  acceptedAt: string | null;
  version: string | null;
  signerName: string | null;
  /**
   * クエリ自体が成功したか。false = カラム不在(マイグレーション未適用)や一時障害。
   * この場合は needsToAcceptTerms が false を返し、ゲートを出さない(fail-open)。
   * fail-closed にすると障害時に /agency 全画面がロックアウトされるため。
   */
  queryOk: boolean;
};

/** organizations から利用規約の同意情報を取得。 */
export async function getOrgTermsAcceptance(organizationId: string): Promise<TermsAcceptance> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("terms_accepted_at, terms_version, terms_signer_name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) {
    // カラム不在 / 一時障害。fail-open でゲートを出さない(ロックアウト回避)。
    return { acceptedAt: null, version: null, signerName: null, queryOk: false };
  }
  const row = data as {
    terms_accepted_at: string | null;
    terms_version: string | null;
    terms_signer_name: string | null;
  } | null;
  return {
    acceptedAt: row?.terms_accepted_at ?? null,
    version: row?.terms_version ?? null,
    signerName: row?.terms_signer_name ?? null,
    queryOk: true,
  };
}

/**
 * 利用規約の同意モーダルを出すべきか:
 *   - クエリ失敗時(queryOk=false)は出さない(fail-open)
 *   - 未同意(acceptedAt = null)
 *   - 古いバージョン(version != CURRENT_TERMS_VERSION)
 */
export function needsToAcceptTerms(a: TermsAcceptance): boolean {
  if (!a.queryOk) return false;
  if (!a.acceptedAt) return true;
  return a.version !== CURRENT_TERMS_VERSION;
}
