/**
 * Flow プリセット の 型 定義
 *
 * Lステップ 相当 の 多段 シナリオ (ma_flows) を code で 定義 する ため の 型。
 * 実データ は lib/ma/flow-presets.ts で 定義 する。
 *
 * 設計 詳細 : docs/line-lstep-ma-design.md
 */
import type { MAChannel } from "./types";

/**
 * ma_flow_steps.action_type の 全 列挙。
 * DB の CHECK 制約 と 完全一致 させる。
 */
export type FlowActionType =
  | "send_message"
  | "assign_tag"
  | "remove_tag"
  | "add_score"
  | "set_field"
  | "wait"
  | "branch"
  | "stop";

/**
 * ma_flows.trigger_type の 全 列挙。
 * DB の CHECK 制約 と 完全一致 させる。
 */
export type FlowTriggerType =
  | "friend_added"
  | "tag_assigned"
  | "tag_removed"
  | "segment_matched"
  | "form_submitted"
  | "postback_received"
  | "keyword_matched"
  | "conversion_event"
  | "manual";

/**
 * プリセット の 1 ステップ 定義。
 * Phase 0 では 全 プリセット が 1 ステップ (send_message) のみ だが、
 * Phase 1 以降 で 多段 化 する ため 配列 型 で 持つ。
 */
export type FlowPresetStep = {
  step_order: number;
  name: string;
  delay_from_previous_seconds: number;
  action_type: FlowActionType;
  /**
   * 旧 ma_scenarios.preset_id (= ma_scenario_presets.key) と の 対応。
   * Backfill 時 に 対応 する ma_templates を 探し 出す ため に 使う。
   * send_message 以外 の ステップ では 未使用。
   */
  legacy_scenario_key?: string;
  action_config?: Record<string, unknown>;
};

/**
 * Flow プリセット 本体。
 *
 * origin_preset_key が Backfill 冪等性 の キー に なる。
 * (同 org × 同 key で 2 回目 は skip)
 */
export type FlowPreset = {
  key: string;
  name: string;
  description: string;
  channel: MAChannel;
  trigger_type: FlowTriggerType;
  trigger_config: Record<string, unknown>;
  goal_event_key: string | null;
  allow_reentry: boolean;
  steps: FlowPresetStep[];
};

/**
 * 旧 ma_scenarios.trigger_days_override を 新 trigger_config に 反映 する。
 *
 * 変換 ルール :
 *   ・trigger_config に "days" キー が ある → override を 上書き
 *   ・trigger_config に "offset_seconds" キー が ある → override * 86400 を 上書き
 *   ・どちら も なければ 無視 (immediate / birthday_today 等)
 *
 * @param preset      プリセット 定義 (immutable)
 * @param override    ma_scenarios.trigger_days_override の 値 (null なら preset デフォルト を そのまま 使う)
 * @returns           Backfill 時 に ma_flows.trigger_config に 書き込む JSON
 */
export function applyTriggerDaysOverride(
  preset: FlowPreset,
  override: number | null,
): Record<string, unknown> {
  if (override === null || override === undefined) {
    return preset.trigger_config;
  }
  const config = { ...preset.trigger_config };
  if ("days" in config) {
    config.days = override;
  } else if ("offset_seconds" in config) {
    config.offset_seconds = override * 86400;
  }
  return config;
}
