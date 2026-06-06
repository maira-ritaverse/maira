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

import { careerProfileSchema, type StoredDiagnosis } from "@/lib/career/profile-schema";
import { createClient } from "@/lib/supabase/server";

/**
 * 求職者の user_id を指定して、その人の診断結果のみを取得する。
 *
 * @param userId 対象の求職者 user_id(通常は client_records.linked_user_id)
 * @returns 診断未実施・未保存・RLS で見えない場合は null
 */
export async function getDiagnosisForUser(userId: string): Promise<StoredDiagnosis | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("career_profiles")
    .select("encrypted_data")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  // bytea → JSON文字列。lib/career/conversations.ts の bytesToText と同じロジック。
  // ここで重複するのは、conversations.ts の bytesToText が export されておらず、
  // また将来本格暗号化を入れる時にこの関数も同じく書き換える方が安全なため。
  const value = data.encrypted_data;
  let jsonString = "";
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      jsonString = Buffer.from(value.slice(2), "hex").toString("utf-8");
    } else {
      jsonString = Buffer.from(value, "base64").toString("utf-8");
    }
  } else if (value instanceof Uint8Array) {
    jsonString = Buffer.from(value).toString("utf-8");
  } else {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonString);
  } catch {
    return null;
  }

  // career_profileSchema で検証(stale/破損データで UI を crash させないため)。
  const validated = careerProfileSchema.safeParse(parsedJson);
  if (!validated.success) return null;

  // 重要:エージェント呼び出し経路では、diagnosis 以外を返さない。
  // RLS は行を返すが、本関数は明示的に diagnosis のみを抽出する(深掘り防御)。
  return validated.data.diagnosis ?? null;
}
