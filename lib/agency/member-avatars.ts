/**
 * 同 org メンバー の アバター 公開 URL を memberId/userId 単位 で 引く Map
 * を 取得 する ヘルパー。
 *
 * SECURITY DEFINER RPC list_organization_member_avatars を 1 回 だけ 呼んで、
 * 呼び出し 側 で メンバー 数 分 並列 fetch しない こと を 保証 する。
 * タスク 担当 / 対応 履歴 / LINE 担当 者 セレクト 等 で 利用 する。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAvatarPublicUrl } from "@/lib/profile/avatar";

export type MemberAvatarMaps = {
  byMemberId: Map<string, string | null>;
  byUserId: Map<string, string | null>;
};

export async function getOrgMemberAvatarMaps(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<MemberAvatarMaps> {
  const byMemberId = new Map<string, string | null>();
  const byUserId = new Map<string, string | null>();

  const { data, error } = await supabase.rpc("list_organization_member_avatars", {
    target_organization_id: organizationId,
  });
  if (error || !data) return { byMemberId, byUserId };

  type Row = { member_id: string; user_id: string; avatar_storage_path: string | null };
  for (const row of data as Row[]) {
    const url = resolveAvatarPublicUrl(supabase, row.avatar_storage_path);
    byMemberId.set(row.member_id, url);
    byUserId.set(row.user_id, url);
  }
  return { byMemberId, byUserId };
}
