/**
 * セグメント の Supabase RPC ラッパ
 *
 * PG 側 の select_friends_by_segment_filter / count_friends_by_segment_filter を
 * TS から 呼ぶ ため の 薄い ラッパ + キャッシュ 更新 ヘルパー。
 *
 * 認可 :
 *   ・authenticated client:呼び出し ユーザー が org member で ある 場合 のみ 成功
 *   ・service_role client:バイパス (dispatcher / cron / API ハンドラ から の 呼び出し)
 *
 * 呼び出し 例 :
 *   const ids = await findFriendsBySegmentFilter(client, orgId, { root: { kind: "has_tag", tag_id: "..." } });
 *   const count = await countFriendsBySegmentFilter(client, orgId, filter);
 *   await refreshSegmentFriendCountCache(client, orgId, segmentId);
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { SegmentFilterSchema, type SegmentFilter } from "./segment-dsl";

/**
 * 一覧 表示 用 の セグメント 行。
 */
export type SegmentListItem = {
  id: string;
  name: string;
  description: string | null;
  filter_dsl_json: SegmentFilter;
  friend_count_cache: number | null;
  last_computed_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 自組織 の セグメント 一覧 を 返す。 一覧 UI と Flow ビルダー の
 * target_segment_id 選択肢 で 共用。
 */
export async function listSegmentsForOrg(
  client: SupabaseClient,
  organizationId: string,
): Promise<SegmentListItem[]> {
  const { data, error } = await client
    .from("line_segments")
    .select(
      "id, name, description, filter_dsl_json, friend_count_cache, last_computed_at, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SegmentListItem[];
}

/**
 * セグメント filter に 一致 する 友だち の line_user_id[] を 返す。
 * filter は Zod で 検証 して から RPC に 渡す (壊れた JSON で PG を 落とさない)。
 */
export async function findFriendsBySegmentFilter(
  client: SupabaseClient,
  organizationId: string,
  filter: SegmentFilter,
): Promise<string[]> {
  const validated = SegmentFilterSchema.parse(filter);
  const { data, error } = await client.rpc("select_friends_by_segment_filter", {
    p_organization_id: organizationId,
    p_filter: validated,
  });
  if (error) throw error;
  return (data ?? []).map((row: { line_user_id: string }) => row.line_user_id);
}

/**
 * セグメント filter に 一致 する 友だち の 件数 を 返す (プレビュー用)。
 */
export async function countFriendsBySegmentFilter(
  client: SupabaseClient,
  organizationId: string,
  filter: SegmentFilter,
): Promise<number> {
  const validated = SegmentFilterSchema.parse(filter);
  const { data, error } = await client.rpc("count_friends_by_segment_filter", {
    p_organization_id: organizationId,
    p_filter: validated,
  });
  if (error) throw error;
  return (data ?? 0) as number;
}

/**
 * line_segments.friend_count_cache を 現時点 の 件数 で 更新 する。
 * セグメント 編集 保存 時 と、 15 分毎 の cron で 呼ぶ (Phase 1 の segment-scan cron)。
 *
 * @returns 計算 した 現時点 の 件数
 */
export async function refreshSegmentFriendCountCache(
  client: SupabaseClient,
  organizationId: string,
  segmentId: string,
): Promise<number> {
  const { data: segment, error: getErr } = await client
    .from("line_segments")
    .select("filter_dsl_json")
    .eq("id", segmentId)
    .eq("organization_id", organizationId)
    .single();
  if (getErr) throw getErr;

  const count = await countFriendsBySegmentFilter(
    client,
    organizationId,
    segment.filter_dsl_json as SegmentFilter,
  );

  const { error: updateErr } = await client
    .from("line_segments")
    .update({
      friend_count_cache: count,
      last_computed_at: new Date().toISOString(),
    })
    .eq("id", segmentId)
    .eq("organization_id", organizationId);
  if (updateErr) throw updateErr;

  return count;
}
