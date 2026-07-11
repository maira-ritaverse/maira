/**
 * Flow プリセット 定義 (LINE 7 種)
 *
 * 既存 ma_scenario_presets (channel='line') の 7 プリセット を、
 * 新 ma_flows 体系 の Flow 定義 として 再表現 する。
 *
 * Phase 0 では 全 プリセット を 「1 ステップ Flow」 として 単純 移行。
 * Phase 1 以降 で オンボーディング Flow の 多段化 等 を 段階的 に 追加。
 *
 * 使用 場所 :
 *   ・scripts/backfill-flow-presets.ts (Backfill 実行)
 *   ・Phase 1 の Flow ビルダー UI (新規 作成 の テンプレ)
 *
 * 詳細 : docs/line-lstep-ma-phase0-plan.md §6
 */
import type { FlowPreset } from "./flow-preset-types";

/**
 * LINE 用 Flow プリセット 7 種。
 * key は 既存 ma_scenario_presets.key と 1:1 で 一致 させる。
 */
export const LINE_FLOW_PRESETS: FlowPreset[] = [
  {
    key: "line_welcome_after_friend",
    name: "LINE 友だち追加後 ウェルカム",
    description: "公式 LINE 友だち追加 直後 の オンボーディング Flow",
    channel: "line",
    trigger_type: "friend_added",
    trigger_config: {},
    goal_event_key: "profile_completed",
    allow_reentry: false,
    steps: [
      {
        step_order: 1,
        name: "ウェルカム メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_welcome_after_friend",
      },
    ],
  },
  {
    key: "line_dormant_outreach",
    name: "LINE 休眠求職者 掘り起こし",
    description: "最終 inbound から 30 日 経過 した 求職者 へ 再 アプローチ",
    channel: "line",
    trigger_type: "segment_matched",
    // segment_kind は Phase 1 の segment 実装 で 使用 する 予約 キー。
    // Phase 0 時点 では マーカー として のみ 保存 する。
    trigger_config: { segment_kind: "last_inbound_days_gte", days: 30 },
    goal_event_key: null,
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "掘り起こし メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_dormant_outreach",
      },
    ],
  },
  {
    key: "line_register_meeting_promotion",
    name: "LINE 登録者 面談促進",
    description: "友だち追加 から N 日 経過 し 面談 未設定 の 場合 に 案内",
    channel: "line",
    trigger_type: "segment_matched",
    trigger_config: { segment_kind: "friend_added_days_gte_no_meeting", days: 3 },
    goal_event_key: "meeting_confirmed",
    allow_reentry: false,
    steps: [
      {
        step_order: 1,
        name: "面談促進 メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_register_meeting_promotion",
      },
    ],
  },
  {
    key: "line_meeting_reminder",
    name: "LINE 面談前 リマインド",
    description: "面談 予定 日 の 1 日前 に リマインド",
    channel: "line",
    trigger_type: "conversion_event",
    // offset_seconds が 負値 = イベント 発生 前 の 送信。
    // 実際 の next_action_at は Phase 1 dispatcher が
    // 対応 する ma_conversion_events.occurred_at + offset で 計算。
    trigger_config: { event_key: "meeting_scheduled", offset_seconds: -86400 },
    goal_event_key: "meeting_completed",
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "面談 リマインド",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_meeting_reminder",
      },
    ],
  },
  {
    key: "line_job_introduction",
    name: "LINE 求人紹介",
    description: "面談 完了 後 N 日 経過 で 応募 が ない 場合 に 求人 を 紹介",
    channel: "line",
    trigger_type: "segment_matched",
    trigger_config: { segment_kind: "meeting_done_days_gte_no_application", days: 3 },
    goal_event_key: "application_submitted",
    allow_reentry: false,
    steps: [
      {
        step_order: 1,
        name: "求人紹介 メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_job_introduction",
      },
    ],
  },
  {
    key: "line_after_interview_followup",
    name: "LINE 面接後 フォロー",
    description: "面接 確定 日 から 1 日後 に フォロー メッセージ",
    channel: "line",
    trigger_type: "conversion_event",
    trigger_config: { event_key: "interview_done", offset_seconds: 86400 },
    goal_event_key: "offer_received",
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "面接後 フォロー",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_after_interview_followup",
      },
    ],
  },
  {
    key: "line_birthday_greeting",
    name: "LINE 誕生日 お祝い",
    description: "求職者 の 誕生日 当日 に お祝い メッセージ",
    channel: "line",
    trigger_type: "segment_matched",
    trigger_config: { segment_kind: "birthday_today" },
    goal_event_key: null,
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "誕生日 メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_birthday_greeting",
      },
    ],
  },
];

/**
 * preset key から プリセット 定義 を 引く。
 */
export function getLineFlowPresetByKey(key: string): FlowPreset | null {
  return LINE_FLOW_PRESETS.find((p) => p.key === key) ?? null;
}
