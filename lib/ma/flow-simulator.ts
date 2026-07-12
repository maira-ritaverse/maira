/**
 * Flow の dry-run シミュレーター。
 *
 * 実 DB 書き込みなしで「この Flow に、この仮想友だちが乗ったら、いつ、どのステップで、
 * 何が起きるか」を予測して返す。既存の evaluator を再利用するだけの純粋関数群。
 *
 * 使い所:
 *   ・admin が Flow を保存する前に「動作確認」する
 *   ・分岐が想定通りに切れるかを確認する
 *   ・「即時 / 3 日待機 / 分岐...」のタイムラインをプレビュー表示
 *
 * 非対象:
 *   ・実際の LINE 送信、テンプレート復号、DB 更新は行わない
 *   ・send_time_window / max_send_per_day 等の実行制約は無視(理想化タイムライン)
 */
import { evaluateBranchCondition, type BranchCondition } from "./flow-branch-evaluator";
import type { SegmentEvalContext } from "./segment-eval";

/** 仮想友だちの入力パラメータ */
export type VirtualFriend = {
  /** 友だち追加からの経過日数(0 = 今日追加) */
  days_since_added: number;
  /** 最終活動からの経過日数(0 = 今アクティブ) */
  days_since_last_activity: number;
  /** 保有タグ ID の一覧 */
  tag_ids: string[];
  /** 友だち情報欄(key-value) */
  fields: Array<{ key: string; value: string }>;
  /** 直近の CV イベント履歴 */
  conversion_events?: Array<{ event_key: string; days_ago: number }>;
  /** クリック済みの Flow ID 一覧 */
  clicked_flow_ids?: string[];
};

/** Flow ステップの入力(DB 行の部分型と一致) */
export type SimStep = {
  step_order: number;
  name: string | null;
  action_type: string;
  delay_from_previous_seconds: number;
  branch_condition_json?: unknown;
  next_step_on_true?: number | null;
  next_step_on_false?: number | null;
  next_step_on_default?: number | null;
};

/** タイムラインの 1 行 */
export type SimTimelineEntry = {
  step_order: number;
  step_name: string | null;
  action_type: string;
  /** シミュレーション開始からの経過秒 */
  elapsed_seconds: number;
  /** 相対時間の人間向けラベル(即時 / 3日後 など) */
  elapsed_label: string;
  /** branch のとき true/false どちらに進んだか(それ以外は null) */
  branch_taken?: "true" | "false" | null;
  /** シミュレーションの終端理由(該当ステップの場合のみ) */
  terminal?: "stop" | "step_missing" | "step_limit" | "no_next";
};

export type SimResult = {
  timeline: SimTimelineEntry[];
  /** timeline が step_limit で切れたか */
  truncated: boolean;
};

const MAX_STEPS = 50;

/** virtual → BranchEvalContext(now を基準に日数を絶対時刻に変換) */
function toBranchContext(
  friend: VirtualFriend,
  now: Date,
): SegmentEvalContext & {
  replied_since_previous_step: boolean;
  clicked_link_in_previous_step: boolean;
  latest_postback_data?: string;
} {
  const daysAgoAsDate = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    organization_id: "sim",
    line_user_id: "sim",
    created_at: daysAgoAsDate(friend.days_since_added),
    last_activity_at: daysAgoAsDate(friend.days_since_last_activity),
    tag_ids: new Set(friend.tag_ids),
    fields: new Map(friend.fields.map((f) => [f.key, f.value] as const)),
    clicked_flow_ids: new Set(friend.clicked_flow_ids ?? []),
    conversion_events: (friend.conversion_events ?? []).map((e) => ({
      event_key: e.event_key,
      occurred_at: daysAgoAsDate(e.days_ago),
    })),
    replied_since_previous_step: false,
    clicked_link_in_previous_step: false,
  };
}

/** 経過秒 → 「即時 / 3 時間後 / 3 日後」等のラベル */
export function formatElapsed(seconds: number): string {
  if (seconds === 0) return "即時";
  if (seconds < 60) return `${seconds}秒後`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分後`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間後`;
  return `${Math.floor(seconds / 86400)}日後`;
}

/**
 * Flow をシミュレーションする。開始ステップ(step_order 1)から順に、
 * 分岐 / 待機 / stop を評価してタイムラインを返す。
 *
 * @param steps  Flow の全ステップ(step_order 昇順)
 * @param friend 仮想友だち
 * @param now    シミュレーション基準時刻(通常は現在)
 */
export function simulateFlow(steps: SimStep[], friend: VirtualFriend, now: Date): SimResult {
  const byOrder = new Map<number, SimStep>();
  for (const s of steps) byOrder.set(s.step_order, s);
  const startOrder = Math.min(...steps.map((s) => s.step_order));

  const ctx = toBranchContext(friend, now);
  const timeline: SimTimelineEntry[] = [];
  let currentOrder: number | null = startOrder;
  let elapsedSeconds = 0;
  let visited = 0;

  while (currentOrder != null && visited < MAX_STEPS) {
    visited += 1;
    const step = byOrder.get(currentOrder);
    if (!step) {
      timeline.push({
        step_order: currentOrder,
        step_name: null,
        action_type: "unknown",
        elapsed_seconds: elapsedSeconds,
        elapsed_label: formatElapsed(elapsedSeconds),
        terminal: "step_missing",
      });
      break;
    }

    // 経過秒を進める(先頭ステップの delay も適用)
    elapsedSeconds += Math.max(0, step.delay_from_previous_seconds);

    let branchTaken: "true" | "false" | null = null;
    let nextOrder: number | null = null;

    if (step.action_type === "branch") {
      const cond = (step.branch_condition_json ?? {
        kind: "and",
        conditions: [],
      }) as BranchCondition;
      const branchNow = new Date(now.getTime() + elapsedSeconds * 1000);
      const outcome = evaluateBranchCondition(cond, ctx, branchNow);
      branchTaken = outcome ? "true" : "false";
      nextOrder = outcome ? (step.next_step_on_true ?? null) : (step.next_step_on_false ?? null);
    } else if (step.action_type === "stop") {
      timeline.push({
        step_order: step.step_order,
        step_name: step.name,
        action_type: step.action_type,
        elapsed_seconds: elapsedSeconds,
        elapsed_label: formatElapsed(elapsedSeconds),
        terminal: "stop",
      });
      break;
    } else {
      nextOrder = step.next_step_on_default ?? null;
    }

    timeline.push({
      step_order: step.step_order,
      step_name: step.name,
      action_type: step.action_type,
      elapsed_seconds: elapsedSeconds,
      elapsed_label: formatElapsed(elapsedSeconds),
      branch_taken: branchTaken,
      terminal: nextOrder == null ? "no_next" : undefined,
    });

    currentOrder = nextOrder;
  }

  return {
    timeline,
    truncated: visited >= MAX_STEPS && currentOrder != null,
  };
}
