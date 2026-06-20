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
 *   tags (任意、 0 件 = フィルタ なし):
 *     指定 タグ の **いずれか** を crm_tags に 持つ client_records と
 *     紐付け 済 の 友達 のみ。 タグ を 指定 する と 自動的 に linked 系
 *     (target='linked' or 'all') と AND に なる (unlinked との 組み合わせ は
 *     論理 矛盾 な ので 結果 0 件)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type BroadcastTargetKind = "all" | "linked" | "unlinked";

export type ResolveTargetsArgs = {
  organizationId: string;
  target: BroadcastTargetKind;
  tags?: string[] | null;
};

/**
 * 配信先 line_user_id 一覧 を 取得。 admin (service_role) で 呼ぶ 前提。
 *
 * 2 段 クエリ:
 *   tags 指定 時 は まず client_records.crm_tags overlaps で 該当 ID を 引き、
 *   それ を line_user_links.client_record_id に IN で 当てる。
 *   tags は 通常 数 件 〜 数十 件 で クライアント 数 も 数千 規模 想定 な ので
 *   この 2 段 で 実用上 問題 ない (LATERAL JOIN 化 は 将来 必要 に なって から)。
 */
export async function resolveBroadcastTargetLineUserIds(
  admin: SupabaseClient,
  args: ResolveTargetsArgs,
): Promise<string[]> {
  // タグ 指定 時 は 該当 client_record_id を 先 に 取得
  let allowedClientIds: Set<string> | null = null;
  if (args.tags && args.tags.length > 0) {
    const { data: matched } = await admin
      .from("client_records")
      .select("id")
      .eq("organization_id", args.organizationId)
      .overlaps("crm_tags", args.tags);
    allowedClientIds = new Set(((matched ?? []) as Array<{ id: string }>).map((c) => c.id));
    if (allowedClientIds.size === 0) return [];
  }

  let query = admin
    .from("line_user_links")
    .select("line_user_id, client_record_id")
    .eq("organization_id", args.organizationId)
    .is("unfollowed_at", null);

  if (args.target === "linked") {
    query = query.not("client_record_id", "is", null);
  } else if (args.target === "unlinked") {
    // unlinked + tags は 論理 矛盾 (タグ は client_record にしか ない)
    if (allowedClientIds) return [];
    query = query.is("client_record_id", null);
  }
  // target='all' + tags 指定 は linked かつ タグ 一致 だけ に なる

  if (allowedClientIds) {
    query = query.in("client_record_id", Array.from(allowedClientIds));
  }

  const { data } = await query;
  type Row = { line_user_id: string; client_record_id: string | null };
  return ((data ?? []) as Row[]).map((r) => r.line_user_id);
}
