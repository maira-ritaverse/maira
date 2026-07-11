/**
 * Flow の branch アクション で 使う 条件 評価。
 *
 * BranchCondition = Segment の 全 kind + Flow 固有 の 4 種
 * (postback / reply / click) を 合わせ た 木構造。
 *
 * Segment 由来 の kind は segment-eval.ts に 委譲 (契約 が 同じ)。
 */
import type { SegmentCondition } from "./segment-dsl";
import { evaluateSegmentCondition, type SegmentEvalContext } from "./segment-eval";

/**
 * Flow 固有 の 分岐 条件。 Segment 側 に は 無い (Flow 実行 文脈 が 前提)。
 */
export type BranchOnlyCondition =
  | { kind: "postback_data_equals"; data: string }
  | { kind: "postback_data_prefix"; prefix: string }
  | { kind: "replied_since_previous_step" }
  | { kind: "clicked_link_in_previous_step" };

/**
 * BranchCondition = Segment の 全 kind + Flow 固有 の 4 種。
 * 木構造 の 中 で 混在 可能 (and/or/not 内 で 両方 使える)。
 */
export type BranchCondition = SegmentCondition | BranchOnlyCondition;

/**
 * Flow 実行 文脈 を 含む 評価 コンテキスト。
 */
export type BranchEvalContext = SegmentEvalContext & {
  /** 最新 の postback data (subscription 開始 以降 で 受信 した もの、 未 受信 は undefined) */
  latest_postback_data?: string;
  /** 前 ステップ 実行 以降 に 求職者 から の 返信 が あった か */
  replied_since_previous_step: boolean;
  /** 前 ステップ の 送信 メッセージ 内 URL を クリック した か */
  clicked_link_in_previous_step: boolean;
};

/**
 * BranchCondition を 評価 する。 Segment 由来 の kind は segment-eval に 委譲。
 * 未知 kind は false (安全側)。
 */
export function evaluateBranchCondition(
  cond: BranchCondition,
  ctx: BranchEvalContext,
  now: Date = new Date(),
): boolean {
  switch (cond.kind) {
    // ─── Flow 固有 ───────────────────────────
    case "postback_data_equals":
      return ctx.latest_postback_data === cond.data;
    case "postback_data_prefix":
      return ctx.latest_postback_data?.startsWith(cond.prefix) ?? false;
    case "replied_since_previous_step":
      return ctx.replied_since_previous_step;
    case "clicked_link_in_previous_step":
      return ctx.clicked_link_in_previous_step;

    // ─── Segment 由来 (and/or/not 含む) ───────────────
    // and/or/not は SegmentCondition 側 で 再帰 評価 される が、 内側 に
    // BranchOnlyCondition が 入る 可能性 が ある。 その 場合 は 再帰的 に
    // ここ の 分岐 に 戻す 必要 が ある。
    case "and": {
      if (cond.conditions.length === 0) return true;
      return cond.conditions.every((c) => evaluateBranchCondition(c as BranchCondition, ctx, now));
    }
    case "or": {
      if (cond.conditions.length === 0) return false;
      return cond.conditions.some((c) => evaluateBranchCondition(c as BranchCondition, ctx, now));
    }
    case "not": {
      return !evaluateBranchCondition(cond.condition as BranchCondition, ctx, now);
    }

    default:
      // Leaf 系 (has_tag / field_* / days_* / clicked_link_in_flow / Phase 2 予約 kind) は
      // segment-eval に 委譲。 未知 kind は segment-eval が false を 返す。
      return evaluateSegmentCondition(cond as SegmentCondition, ctx, now);
  }
}
