/**
 * LINE 会話 タグ (line_conversation_tags) の 取得 ヘルパー。
 *
 * 既存 の クライアント側 タグ (client_records.crm_tags) と は 別 で、
 * LINE 友達 (line_user_links) に 直接 紐付け される タグ。
 * 友達 が client_records に 連携 されて いなく ても 使え る の が ポイント。
 */
import { createClient } from "@/lib/supabase/server";

export type LineConversationTag = {
  id: string;
  name: string;
  color: string | null;
};

/**
 * 自組織 の LINE 会話 タグ 一覧 を 名前 昇順 で 取得。
 */
export async function listOrganizationLineTags(
  organizationId: string,
): Promise<LineConversationTag[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("line_conversation_tags")
    .select("id, name, color")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  return (data ?? []) as LineConversationTag[];
}

/**
 * タグ 統計 (UI で 「タグ ピッカー が 空 の 時 の 原因 切り分け」 用)。
 *
 *   totalTags         自組織 の タグ マスタ 数
 *   assignedFriends   1 件 以上 タグ が 付いて いる 友達 数
 */
export async function getOrganizationLineTagsStats(organizationId: string): Promise<{
  tags: LineConversationTag[];
  totalTags: number;
  assignedFriends: number;
}> {
  const supabase = await createClient();
  const [tagsRes, assignmentsRes] = await Promise.all([
    supabase
      .from("line_conversation_tags")
      .select("id, name, color")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    supabase
      .from("line_conversation_tag_assignments")
      .select("line_user_id")
      .eq("organization_id", organizationId),
  ]);
  const tags = (tagsRes.data ?? []) as LineConversationTag[];
  type Row = { line_user_id: string };
  const uniqueFriends = new Set(((assignmentsRes.data ?? []) as Row[]).map((r) => r.line_user_id));
  return {
    tags,
    totalTags: tags.length,
    assignedFriends: uniqueFriends.size,
  };
}
