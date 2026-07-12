/**
 * LINE 一斉配信 の 送信先 line_user_id 取得 を 1 箇所 に 集約。
 *
 * UI / 即時送信 (broadcasts POST) / 予約配信 (cron) で 同じ ロジック を 使う ため。
 *
 * フィルタ 仕様:
 *   target = 'all'      → 全 友達 (unfollowed 除く)
 *   target = 'linked'   → client_records 紐付け 済 の 友達 のみ
 *   target = 'unlinked' → 紐付け 無し の 友達 のみ
 *
 *   tagIds (任意、 0 件 = フィルタ なし):
 *     指定 LINE 会話 タグ (line_conversation_tags) の **いずれか** が
 *     line_conversation_tag_assignments で 紐付け されて いる 友達 のみ。
 *     client_records への 連携 有無 と は **無関係** (LINE 友達 単位 の タグ
 *     な ので、 未連携 でも タグ 付き なら 対象 に なる)。
 *
 *   segmentId (任意、 P1-H で 追加):
 *     line_segments.filter_dsl_json に 一致 する 友達 のみ。
 *     tagIds と 併用 時 は AND (両方 満たす)。
 *     Flow の target_segment_id と 同じ 動的 セグメント 基盤 を 使用。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { findFriendsBySegmentFilter } from "@/lib/ma/segment-queries";
import type { SegmentFilter } from "@/lib/ma/segment-dsl";

export type BroadcastTargetKind = "all" | "linked" | "unlinked";

export type ResolveTargetsArgs = {
  organizationId: string;
  target: BroadcastTargetKind;
  /** LINE 会話 タグ ID 配列。 0 件 / null は フィルタ なし。 */
  tagIds?: string[] | null;
  /** 動的 セグメント ID。 指定 時 は line_segments.filter_dsl_json で 追加 絞込。 */
  segmentId?: string | null;
};

/**
 * 配信先 line_user_id 一覧 を 取得。 admin (service_role) で 呼ぶ 前提。
 */
export async function resolveBroadcastTargetLineUserIds(
  admin: SupabaseClient,
  args: ResolveTargetsArgs,
): Promise<string[]> {
  // タグ 指定 時 は 該当 タグ が 付いて いる line_user_id を 先 に 取得
  let tagFilterSet: Set<string> | null = null;
  if (args.tagIds && args.tagIds.length > 0) {
    const { data: matched } = await admin
      .from("line_conversation_tag_assignments")
      .select("line_user_id")
      .eq("organization_id", args.organizationId)
      .in("tag_id", args.tagIds);
    tagFilterSet = new Set(
      ((matched ?? []) as Array<{ line_user_id: string }>).map((r) => r.line_user_id),
    );
    if (tagFilterSet.size === 0) return [];
  }

  // セグメント 指定 時 は 該当 friend を 取得
  let segmentFilterSet: Set<string> | null = null;
  if (args.segmentId) {
    const { data: seg } = await admin
      .from("line_segments")
      .select("filter_dsl_json")
      .eq("id", args.segmentId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();
    if (!seg) return [];
    const ids = await findFriendsBySegmentFilter(
      admin,
      args.organizationId,
      seg.filter_dsl_json as SegmentFilter,
    );
    segmentFilterSet = new Set(ids);
    if (segmentFilterSet.size === 0) return [];
  }

  // tag と segment 併用 時 は AND
  let allowedLineUserIds: Set<string> | null = null;
  if (tagFilterSet && segmentFilterSet) {
    allowedLineUserIds = new Set(
      Array.from(tagFilterSet).filter((id) => segmentFilterSet!.has(id)),
    );
    if (allowedLineUserIds.size === 0) return [];
  } else {
    allowedLineUserIds = tagFilterSet ?? segmentFilterSet;
  }

  let query = admin
    .from("line_user_links")
    .select("line_user_id, client_record_id")
    .eq("organization_id", args.organizationId)
    .is("unfollowed_at", null);

  if (args.target === "linked") {
    query = query.not("client_record_id", "is", null);
  } else if (args.target === "unlinked") {
    query = query.is("client_record_id", null);
  }

  if (allowedLineUserIds) {
    query = query.in("line_user_id", Array.from(allowedLineUserIds));
  }

  const { data } = await query;
  type Row = { line_user_id: string; client_record_id: string | null };
  return ((data ?? []) as Row[]).map((r) => r.line_user_id);
}
