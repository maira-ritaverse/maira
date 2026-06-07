// 診断結果のサーバーサイド取得ヘルパー。
//
// 求職者本人が読む経路は lib/career/conversations.ts の getCareerProfile を使う。
// ここでは「エージェント側がリンク済みクライアントの診断結果を読む」用途のヘルパーを置く。
//
// セキュリティの方針:
// - DB レベルの RLS で「組織メンバー × linked クライアント」のみ通る
//   (migration: 20260601000003_agency_view_linked_client_career_profile.sql)。
// - そのうえで、コード側では client.linkStatus === "linked" の二重チェックを行い、
//   かつ返却するのは StoredDiagnosis(診断部分のみ)に絞る。
//   career_profile の棚卸し本体(summary 等)をエージェント側にうっかり露出させないため。
//
// Step 5 改修:復号を lib/career/conversations.ts の decodeCareerProfileBlob に
// 一本化(本人経路と同じ復号パイプラインを通す = DRY)。v2 を優先しつつ未バック
// フィル行は旧 bytea にフォールバック。アプリ層の「diagnosis のみ抽出」は温存し、
// career_profile の他フィールドはこの関数の戻り値には含めない。

import { decodeCareerProfileBlob } from "@/lib/career/conversations";
import type { StoredDiagnosis } from "@/lib/career/profile-schema";
import { createClient } from "@/lib/supabase/server";

/**
 * 求職者の user_id を指定して、その人の診断結果のみを取得する。
 *
 * @param userId 対象の求職者 user_id(通常は client_records.linked_user_id)
 * @returns 診断未実施・未保存・RLS で見えない場合は null
 */
export async function getDiagnosisForUser(userId: string): Promise<StoredDiagnosis | null> {
  const supabase = await createClient();

  // 移行期間中は両列取得。decodeCareerProfileBlob 内で v2 → 旧 bytea の順に
  // フォールバック復号する。Step 6 で旧列が DROP されたら v2 のみに絞る。
  const { data, error } = await supabase
    .from("career_profiles")
    .select("encrypted_data, encrypted_data_v2")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const profile = await decodeCareerProfileBlob({
    encrypted_data: data.encrypted_data,
    encrypted_data_v2: data.encrypted_data_v2,
  });
  if (!profile) return null;

  // 重要:エージェント呼び出し経路では、diagnosis 以外を返さない。
  // RLS は行を返すが、本関数は明示的に diagnosis のみを抽出する(深掘り防御)。
  return profile.diagnosis ?? null;
}
