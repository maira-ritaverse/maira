/**
 * 対応履歴(client_interactions)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業の履歴のみが返る。
 * client_records / referrals と同じ構造で揃えている。
 *
 * 一覧では「誰が記録したか」を表示するため、
 * list_organization_member_display_names(SECURITY DEFINER)で
 * メンバー表示名 Map を合流する(profiles の RLS を緩めずに済ませるため)。
 */

import { getOrgMemberAvatarMaps } from "@/lib/agency/member-avatars";
import { createClient } from "@/lib/supabase/server";

import type { ClientInteraction, ClientInteractionWithAuthor, InteractionType } from "./types";

type ClientInteractionRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  referral_id: string | null;
  author_member_id: string | null;
  interaction_type: string;
  occurred_at: string;
  summary: string | null;
  body: string | null;
  created_at: string;
  updated_at: string;
};

function rowToInteraction(row: ClientInteractionRow): ClientInteraction {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    referralId: row.referral_id,
    authorMemberId: row.author_member_id,
    interactionType: row.interaction_type as InteractionType,
    occurredAt: row.occurred_at,
    summary: row.summary,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * あるクライアントの対応履歴一覧(記録者表示名を含む)
 *
 * 並び順は occurred_at 降順(新しい対応が上)。
 * 記録者の表示名は別 RPC で取得して Map で合流する(referrals/clients と同じ方針)。
 */
export async function listInteractionsByClient(
  clientRecordId: string,
  organizationId: string,
): Promise<ClientInteractionWithAuthor[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_interactions")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .order("occurred_at", { ascending: false });

  if (error || !data) return [];

  const interactions = (data as ClientInteractionRow[]).map(rowToInteraction);

  // 記録者の 表示名 / avatar URL Map を 並列 取得 (RLS バイパス関数経由)
  // 取得に失敗しても履歴自体は返す(author* は null になる)
  const [{ data: memberRows, error: memberError }, avatarMaps] = await Promise.all([
    supabase.rpc("list_organization_member_display_names", {
      target_organization_id: organizationId,
    }),
    getOrgMemberAvatarMaps(supabase, organizationId),
  ]);

  const nameByMemberId = new Map<string, string | null>();
  if (!memberError && memberRows) {
    for (const row of memberRows as Array<{ member_id: string; display_name: string | null }>) {
      nameByMemberId.set(row.member_id, row.display_name);
    }
  }

  return interactions.map((it) => ({
    ...it,
    authorName: it.authorMemberId ? (nameByMemberId.get(it.authorMemberId) ?? null) : null,
    authorAvatarUrl: it.authorMemberId
      ? (avatarMaps.byMemberId.get(it.authorMemberId) ?? null)
      : null,
  }));
}
