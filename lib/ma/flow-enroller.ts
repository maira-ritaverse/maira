/**
 * Flow の trigger イベント → ma_flow_subscriptions 生成 (enroll) を 担う。
 *
 * 呼び出し 元 :
 *   ・lib/line/event-handler.ts の handleFollow → friend_added
 *   ・lib/line/event-handler.ts の handlePostback → postback_received
 *   ・app/api/agency/line/tag-assignments/[lineUserId]/route.ts → tag_assigned / tag_removed
 *   ・app/api/internal/ma/segment-scan/route.ts → segment_matched
 *   ・(将来) form 送信、 conversion 発火、 keyword 応答、 手動 enroll
 *
 * 実装 方針 :
 *   ・enrollFriendToFlow は 1 subscription 生成 の 単一 責務。 flow の
 *     is_active / allow_reentry / target_segment_id を 順に 判定。
 *   ・dispatchFlowTrigger は 該当 org × trigger_type の 全 active Flow を
 *     見つけ て 順に enroll する 高レベル API。 webhook / タグ 変更 から
 *     呼ばれ る の で 例外 は 呼び出し 側 で 握り 潰す (best-effort)。
 *
 * 設計 : docs/line-lstep-ma-design.md §7.1 / phase1-plan §4.3
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeNextActionAt, parseSendTimeWindow } from "./flow-scheduler";

// ────────────────────────────────────────
// 型
// ────────────────────────────────────────

/**
 * Trigger 発火 元 の イベント。 trigger_type と 完全 対応。
 */
export type TriggerEvent =
  | { type: "friend_added"; line_user_id: string }
  | { type: "tag_assigned"; line_user_id: string; tag_id: string }
  | { type: "tag_removed"; line_user_id: string; tag_id: string }
  | { type: "postback_received"; line_user_id: string; postback_data: string }
  | { type: "form_submitted"; line_user_id: string; form_id: string }
  | { type: "segment_matched"; line_user_id: string; segment_id: string }
  | { type: "conversion_event"; line_user_id: string; event_key: string; occurred_at: Date }
  | { type: "keyword_matched"; line_user_id: string; keyword: string }
  | { type: "manual"; line_user_id: string };

/**
 * findMatchingFlowsForEvent が 返す 型 (enrollFriendToFlow で 再 SELECT を 避ける ため 一括 取得)。
 */
export type FlowMatchRow = {
  id: string;
  organization_id: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  target_segment_id: string | null;
  allow_reentry: boolean;
  is_active: boolean;
  send_time_window_json: unknown;
};

export type EnrollResult =
  | { kind: "enrolled"; subscription_id: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string };

export type DispatchResult = {
  matched_flows: number;
  enrolled: number;
  skipped: number;
  failed: number;
  details: Array<{ flow_id: string; result: EnrollResult }>;
};

// ────────────────────────────────────────
// 純粋 関数: trigger_config と event の 一致 判定
// (テスト しやすい よう DB に 依存 しない)
// ────────────────────────────────────────

/**
 * flow.trigger_config と event の パラメータ が 一致 する か。
 * trigger_type 一致 は 呼び出し 側 で 保証 する 想定 だが、 安全 のため 再チェック。
 */
export function isTriggerConfigMatch(
  flow: Pick<FlowMatchRow, "trigger_type" | "trigger_config">,
  event: TriggerEvent,
): boolean {
  if (flow.trigger_type !== event.type) return false;

  switch (event.type) {
    case "friend_added":
      return true;
    case "manual":
      return true;
    case "tag_assigned":
    case "tag_removed":
      return flow.trigger_config.tag_id === event.tag_id;
    case "postback_received": {
      const prefix = flow.trigger_config.postback_data_prefix;
      if (typeof prefix === "string" && prefix.length > 0) {
        return event.postback_data.startsWith(prefix);
      }
      const exact = flow.trigger_config.postback_data;
      if (typeof exact === "string") {
        return event.postback_data === exact;
      }
      return true;
    }
    case "form_submitted":
      return flow.trigger_config.form_id === event.form_id;
    case "conversion_event":
      return flow.trigger_config.event_key === event.event_key;
    case "keyword_matched": {
      // Flow の trigger_config.keyword を case-insensitive 部分一致 で 判定 する。
      // 完全 一致 にしたい 場合 は match_mode='exact' を 指定。
      // 呼び出し 側 で pre-filter する 用途 に 合わせて、 keyword が
      // 未設定 なら false (unconfigured Flow を 全 event に マッチさせない)。
      const raw = flow.trigger_config.keyword;
      if (typeof raw !== "string" || raw.trim().length === 0) return false;
      const keyword = raw.trim().toLowerCase();
      const text = event.keyword.trim().toLowerCase();
      const mode = flow.trigger_config.match_mode;
      if (mode === "exact") return text === keyword;
      return text.includes(keyword);
    }
    case "segment_matched":
      return flow.trigger_config.segment_id === event.segment_id;
    default: {
      // 型 の exhaustiveness チェック
      const _exhaust: never = event;
      return false;
    }
  }
}

// ────────────────────────────────────────
// 主関数
// ────────────────────────────────────────

/**
 * 特定 の Flow に 1 friend を enroll する。
 * is_active / allow_reentry / target_segment_id を 判定 し、 subscription を INSERT。
 */
export async function enrollFriendToFlow(
  supabase: SupabaseClient,
  flowId: string,
  lineUserId: string,
  options: {
    clientRecordId?: string | null;
    enteredVia?: "trigger_auto" | "manual" | "imported";
    baseTime?: Date;
    /** target_segment_id の 一致 判定 を 呼び出し 側 で 済ませ た 場合 に true */
    skipSegmentCheck?: boolean;
  } = {},
): Promise<EnrollResult> {
  const { data: flowRow, error: flowErr } = await supabase
    .from("ma_flows")
    .select(
      "id, organization_id, target_segment_id, allow_reentry, is_active, send_time_window_json",
    )
    .eq("id", flowId)
    .maybeSingle();
  if (flowErr || !flowRow) {
    return { kind: "skipped", reason: "flow_not_found" };
  }
  const flow = flowRow as {
    id: string;
    organization_id: string;
    target_segment_id: string | null;
    allow_reentry: boolean;
    is_active: boolean;
    send_time_window_json: unknown;
  };

  if (!flow.is_active) {
    return { kind: "skipped", reason: "flow_inactive" };
  }

  // allow_reentry=false なら 過去 subscription の 有無 を チェック
  if (!flow.allow_reentry) {
    const { data: existing } = await supabase
      .from("ma_flow_subscriptions")
      .select("id")
      .eq("flow_id", flowId)
      .eq("line_user_id", lineUserId)
      .limit(1);
    if ((existing ?? []).length > 0) {
      return { kind: "skipped", reason: "already_enrolled" };
    }
  }

  // target_segment_id 判定
  if (flow.target_segment_id && !options.skipSegmentCheck) {
    const { data: seg } = await supabase
      .from("line_segments")
      .select("filter_dsl_json")
      .eq("id", flow.target_segment_id)
      .maybeSingle();
    if (!seg) {
      return { kind: "skipped", reason: "target_segment_not_found" };
    }
    // 該当 friend が セグメント に 入って いる か 検査
    const { data: matches } = await supabase.rpc("select_friends_by_segment_filter", {
      p_organization_id: flow.organization_id,
      p_filter: seg.filter_dsl_json,
    });
    const ids = new Set(
      ((matches ?? []) as Array<{ line_user_id: string }>).map((r) => r.line_user_id),
    );
    if (!ids.has(lineUserId)) {
      return { kind: "skipped", reason: "segment_mismatch" };
    }
  }

  // Step 1 の delay を 取得 して next_action_at を 計算
  const { data: step1 } = await supabase
    .from("ma_flow_steps")
    .select("delay_from_previous_seconds")
    .eq("flow_id", flowId)
    .eq("step_order", 1)
    .maybeSingle();
  if (!step1) {
    return { kind: "skipped", reason: "no_step1" };
  }
  const window = parseSendTimeWindow(flow.send_time_window_json);
  const baseTime = options.baseTime ?? new Date();
  const nextAt = computeNextActionAt(
    baseTime,
    (step1 as { delay_from_previous_seconds: number }).delay_from_previous_seconds,
    window,
  );

  const insertRes = await supabase
    .from("ma_flow_subscriptions")
    .insert({
      organization_id: flow.organization_id,
      flow_id: flowId,
      line_user_id: lineUserId,
      client_record_id: options.clientRecordId ?? null,
      current_step_order: 1,
      next_action_at: nextAt.toISOString(),
      status: "active",
      entered_via: options.enteredVia ?? "trigger_auto",
      entered_at: baseTime.toISOString(),
    })
    .select("id")
    .single();

  if (insertRes.error) {
    // 部分 unique index (status IN active/paused) に 引っかかる = 実質 重複
    if (insertRes.error.code === "23505") {
      return { kind: "skipped", reason: "duplicate_active_subscription" };
    }
    return { kind: "failed", error: insertRes.error.message };
  }
  return { kind: "enrolled", subscription_id: insertRes.data.id };
}

/**
 * イベント に 一致 する 全 active Flow を 引く。 org スコープ + trigger_type 完全一致 で 絞ってから
 * trigger_config を メモリ上 で フィルタ。
 */
export async function findMatchingFlowsForEvent(
  supabase: SupabaseClient,
  organizationId: string,
  event: TriggerEvent,
): Promise<FlowMatchRow[]> {
  const { data } = await supabase
    .from("ma_flows")
    .select(
      "id, organization_id, trigger_type, trigger_config, target_segment_id, allow_reentry, is_active, send_time_window_json",
    )
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("trigger_type", event.type);
  const rows = (data ?? []) as FlowMatchRow[];
  return rows.filter((f) => isTriggerConfigMatch(f, event));
}

/**
 * イベント に 一致 する 全 Flow に 1 friend を enroll する。
 * webhook / API から 呼ばれ、 内部 例外 は 集約 して 返す (best-effort)。
 */
export async function dispatchFlowTrigger(
  supabase: SupabaseClient,
  organizationId: string,
  event: TriggerEvent,
): Promise<DispatchResult> {
  const flows = await findMatchingFlowsForEvent(supabase, organizationId, event);
  const details: DispatchResult["details"] = [];
  let enrolled = 0;
  let skipped = 0;
  let failed = 0;

  for (const flow of flows) {
    let result: EnrollResult;
    try {
      result = await enrollFriendToFlow(supabase, flow.id, event.line_user_id);
    } catch (err) {
      result = { kind: "failed", error: err instanceof Error ? err.message : String(err) };
    }
    details.push({ flow_id: flow.id, result });
    if (result.kind === "enrolled") enrolled++;
    else if (result.kind === "skipped") skipped++;
    else failed++;
  }

  return { matched_flows: flows.length, enrolled, skipped, failed, details };
}
