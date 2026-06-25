/**
 * 求職者 (client_records) に 紐づく 副 担当 (collaborator) の クエリ。
 *
 * 主 担当 は client_records.assigned_member_id で、 こちら の クエリ は 副 担当 のみ を 扱う。
 * 詳細 ページ の 表示 / 追加 / 削除 で 共通 で 使う。
 */
import { createClient } from "@/lib/supabase/server";

export type Collaborator = {
  memberId: string;
  displayName: string | null;
  addedAt: string;
  addedByMemberId: string | null;
};

/**
 * 1 求職者 の 副 担当 一覧 を 取得 する。
 *
 * member の 表示 名 は organization_members + profiles を 結合 して 取得。
 * RLS で 同 組織 のみ 取得 可能。
 */
export async function listCollaboratorsForClient(clientRecordId: string): Promise<Collaborator[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_record_collaborators")
    .select(
      `
        member_id,
        added_at,
        added_by_member_id,
        organization_members!client_record_collaborators_member_id_fkey (
          user_id,
          profiles (
            display_name
          )
        )
      `,
    )
    .eq("client_record_id", clientRecordId)
    .order("added_at", { ascending: true });

  if (error || !data) return [];

  type NestedRow = {
    member_id: string;
    added_at: string;
    added_by_member_id: string | null;
    // Supabase の to-one リレーション は 型生成上 配列 として 来る ケース が ある ので
    // 配列 / 単一 両方 を 受け付け て 正規 化 する
    organization_members:
      | { profiles: { display_name: string | null } | { display_name: string | null }[] | null }
      | { profiles: { display_name: string | null } | { display_name: string | null }[] | null }[]
      | null;
  };

  return (data as unknown as NestedRow[]).map((row) => {
    const memRaw = row.organization_members;
    const mem = Array.isArray(memRaw) ? (memRaw[0] ?? null) : memRaw;
    const profileRaw = mem?.profiles ?? null;
    const profile = Array.isArray(profileRaw) ? (profileRaw[0] ?? null) : profileRaw;
    return {
      memberId: row.member_id,
      displayName: profile?.display_name ?? null,
      addedAt: row.added_at,
      addedByMemberId: row.added_by_member_id ?? null,
    };
  });
}
