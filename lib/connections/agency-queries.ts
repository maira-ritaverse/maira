import { decodeCareerProfileBlob } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";
import { extractDisclosableProfile, type DisclosableProfile } from "./disclosable-profile";

/**
 * エージェント側:linked クライアントの希望条件・プロフィール取得
 *
 * 経路設計(Phase 5):
 *   1. DB 側 SECURITY DEFINER RPC `get_linked_client_encrypted_career_profile` に
 *      clientRecordId を渡す。RPC が「呼び出しエージェントが linked 自組織」を
 *      検証し、暗号文(career_profiles.encrypted_data)だけを返す。
 *   2. Next.js 側で decryptField → JSON.parse → schema 検証(decodeCareerProfileBlob)
 *      → extractDisclosableProfile で内面を捨て、UI へ DisclosableProfile を返す。
 *
 * 内面(strengths/values/concerns/summary/diagnosis)は型レベルで戻り値に含まれず、
 * disclosable-profile.test.ts で「シリアライズ結果に内面 sentinel が現れない」ことも
 * 検証している。本関数の責務は「経路を 1 本に揃え、UI が誤って内面に手を伸ばせない」
 * 境界を作ること。
 *
 * 戻り値の意味:
 *   - DisclosableProfile:取得成功
 *   - null:career_profile が未作成(=RPC が null を返した)、または復号 / 検証失敗
 *           (どちらも UI 側で「希望条件は未登録」フォールバックに倒す)
 *   - throw:認可失敗(forbidden / not_found / unauthenticated)。呼び出し側で
 *           notFound() に倒すか、ログに残す。
 */
export async function getDisclosableProfileForLinkedClient(
  clientRecordId: string,
): Promise<DisclosableProfile | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_linked_client_encrypted_career_profile", {
    p_client_record_id: clientRecordId,
  });

  if (error) {
    // 認可エラー(forbidden / not_found / unauthenticated)は本関数の責務外なので
    // throw して呼び出し側にハンドリングさせる。
    throw new Error(error.message);
  }

  // career_profile が未作成のクライアントは RPC が null を返す(エラーではない)。
  if (typeof data !== "string" || data.length === 0) {
    return null;
  }

  // 復号 + schema 検証(本人経路と同じ単一経路を再利用)。
  // 失敗時は decodeCareerProfileBlob が null を返すので、UI は「未登録」と同じ
  // フォールバックに倒す。
  const profile = await decodeCareerProfileBlob(data);
  if (!profile) return null;

  // 内面を捨て、wants と user_facts(限定)のみに絞る。型レベルで内面が
  // 戻り値型に含まれないため、ここから先のコードは内面を触れない。
  return extractDisclosableProfile(profile);
}
