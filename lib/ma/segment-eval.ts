/**
 * セグメント / 分岐 条件 の in-memory 評価
 *
 * PG 側 (build_segment_where) は 一括 検索 用、 こちら は 単一 friend の 判定 用。
 * 主な 使い所 :
 *   ・dispatcher が enroll 前 に 「この 友達 は target_segment に 該当 か」 を
 *     問い合わせ る ホット パス (RPC より 高速)
 *   ・Flow の branch アクション の 分岐 判定
 *   ・テスト シミュレーター (仮想 friend で 分岐 プレビュー)
 *
 * PG 側 と 挙動 が 一致 する こと が 契約。 テスト で 両者 を 突き合わせ る。
 */
import type { SegmentCondition } from "./segment-dsl";

/**
 * 単一 friend の 評価 コンテキスト。
 * 呼び出し 側 が 事前 に 必要 な データ を まとめ る (dispatcher なら
 * DB から 一括 取得 → 全 Flow 分 を この ctx で 順に 評価)。
 */
export type SegmentEvalContext = {
  organization_id: string;
  line_user_id: string;
  /** 友達 追加 日 (line_user_links.created_at) */
  created_at: Date;
  /** 最終 活動 日 (line_user_links.last_activity_at) */
  last_activity_at: Date;
  /** 友達 が 保有 する タグ ID セット */
  tag_ids: Set<string>;
  /** 友だち 情報欄 (friend_fields) */
  fields: Map<string, string>;
  /** クリック を 通した Flow ID セット (clicked_link_in_flow 用) */
  clicked_flow_ids: Set<string>;
  /** Phase 2 予約 : 熱量 スコア (実装 まで 常に 0 として 扱う) */
  engagement_score?: number;
  /** Phase 3 予約 : 登録元 コード (実装 まで null) */
  entry_source_code?: string | null;
};

/**
 * SegmentCondition を ctx 上 で 評価 して boolean を 返す。
 *
 * @param cond 評価 する 条件
 * @param ctx  friend の 現時点 データ
 * @param now  基準 時刻 (テスト で 固定 する ため 引数化。 デフォルト は 現在)
 */
export function evaluateSegmentCondition(
  cond: SegmentCondition,
  ctx: SegmentEvalContext,
  now: Date = new Date(),
): boolean {
  switch (cond.kind) {
    case "and":
      // 空 and は true (全員 一致)。 PG 側 と 一致。
      if (cond.conditions.length === 0) return true;
      return cond.conditions.every((c) => evaluateSegmentCondition(c, ctx, now));
    case "or":
      // 空 or は false (誰も 一致 しない)。 PG 側 と 一致。
      if (cond.conditions.length === 0) return false;
      return cond.conditions.some((c) => evaluateSegmentCondition(c, ctx, now));
    case "not":
      return !evaluateSegmentCondition(cond.condition, ctx, now);

    case "has_tag":
      return ctx.tag_ids.has(cond.tag_id);
    case "not_has_tag":
      return !ctx.tag_ids.has(cond.tag_id);

    case "field_equals":
      return ctx.fields.get(cond.key) === cond.value;
    case "field_exists":
      return ctx.fields.has(cond.key);

    case "days_since_last_activity_gte":
      return daysBetween(ctx.last_activity_at, now) >= cond.days;
    case "days_since_added_lte":
      return daysBetween(ctx.created_at, now) <= cond.days;
    case "days_since_added_gte":
      return daysBetween(ctx.created_at, now) >= cond.days;

    case "clicked_link_in_flow":
      return ctx.clicked_flow_ids.has(cond.flow_id);

    // Phase 2 予約 : engagement_score 列 が Phase 2 で 追加 される まで 常に false
    // (PG 側 build_segment_where と 揃える)
    case "score_gte":
    case "score_lte":
      return false;

    // Phase 3 予約 : entry_source_code 列 が Phase 3 で 追加 される まで 常に false
    case "entry_source_in":
      return false;

    // Phase 2 予約 : ma_conversion_events が Phase 2 で 追加 される まで 常に false
    case "conversion_event_present":
    case "conversion_event_absent":
      return false;

    default: {
      // TS の exhaustiveness チェック。 新 kind 追加時 に コンパイル エラー で 気付く。
      const _exhaust: never = cond;
      return false;
    }
  }
}

/**
 * SegmentFilter (root ラップ済) を 評価 する ラッパ。
 */
export function evaluateSegmentFilter(
  filter: { root: SegmentCondition },
  ctx: SegmentEvalContext,
  now: Date = new Date(),
): boolean {
  return evaluateSegmentCondition(filter.root, ctx, now);
}

/**
 * 2 つ の Date 間 の 「日数 差」 を 切り捨て 整数 で 返す (from ≤ to 前提)。
 * ミリ秒 差 / 86400000 を floor。 to < from の 場合 は 負値 を 返す (呼び出し 側 の 責任)。
 */
function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}
