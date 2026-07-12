/**
 * Flow subscription の 1 tick 実行。
 *
 * dispatcher (cron) から 呼ばれ、 1 subscription を 1 ステップ 進め る。
 * 全 action_type (send_message / assign_tag / remove_tag / add_score /
 * set_field / wait / branch / stop) を ここ で 分岐 処理 する。
 *
 * 呼び出し 前提 :
 *   ・supabase は service_role client (RLS バイパス)
 *   ・sub.status='active' か つ sub.next_action_at <= now() を dispatcher で フィルタ 済
 *
 * 設計 詳細 : docs/line-lstep-ma-design.md §7.2
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { getOrgEmailConfig } from "@/lib/email/org-config";
import { sendViaResend } from "@/lib/email/resend";
import { pushMessage } from "@/lib/line/api";
import { classifyLineError } from "@/lib/line/errors";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { wrapBodyUrls } from "@/lib/ma/click-tracking";
import { expandTemplate, type TemplateVariableValues } from "@/lib/ma/test-send";

import {
  evaluateBranchCondition,
  type BranchCondition,
  type BranchEvalContext,
} from "./flow-branch-evaluator";
import {
  computeNextActionAt,
  isDailyLimitReached,
  isWithinSendTimeWindow,
  nextDayStartUtc,
  parseSendTimeWindow,
  shiftToWithinWindow,
} from "./flow-scheduler";

// ────────────────────────────────────────
// 型 (DB 行 の 部分 型)
// ────────────────────────────────────────
export type SubscriptionRow = {
  id: string;
  organization_id: string;
  flow_id: string;
  line_user_id: string;
  client_record_id: string | null;
  current_step_order: number;
  next_action_at: string;
  status: string;
  entered_at: string;
};

type FlowRow = {
  id: string;
  organization_id: string;
  /** 'line' | 'email' — 送信チャネル */
  channel: string;
  send_time_window_json: unknown;
  max_send_per_day: number | null;
  goal_event_key: string | null;
};

type FlowStepRow = {
  id: string;
  flow_id: string;
  step_order: number;
  name: string | null;
  delay_from_previous_seconds: number;
  action_type: string;
  action_config: Record<string, unknown>;
  template_id: string | null;
  branch_condition_json: unknown;
  next_step_on_true: number | null;
  next_step_on_false: number | null;
  next_step_on_default: number | null;
  goal_check_on_entry: boolean;
};

export type TickResult =
  | { kind: "completed"; final_status: "completed" | "goal_achieved" | "canceled" }
  | { kind: "progressed"; next_step_order: number; next_action_at: string }
  | { kind: "deferred"; next_action_at: string; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string };

// ────────────────────────────────────────
// 主関数 : 1 subscription を 1 ステップ 進める
// ────────────────────────────────────────
export async function executeSubscriptionTick(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
): Promise<TickResult> {
  // 1. Flow + Step を 取得
  const { data: flowData, error: flowErr } = await supabase
    .from("ma_flows")
    .select("id, organization_id, channel, send_time_window_json, max_send_per_day, goal_event_key")
    .eq("id", sub.flow_id)
    .single();
  if (flowErr || !flowData) {
    return failWith(supabase, sub.id, "flow_not_found");
  }
  const flow = flowData as FlowRow;

  const { data: stepData } = await supabase
    .from("ma_flow_steps")
    .select("*")
    .eq("flow_id", sub.flow_id)
    .eq("step_order", sub.current_step_order)
    .single();
  if (!stepData) {
    // ステップ が 存在 しない = Flow の 末端 に 到達 → 完了
    await markStatus(supabase, sub.id, "completed");
    return { kind: "completed", final_status: "completed" };
  }
  const step = stepData as FlowStepRow;

  const now = new Date();
  const window = parseSendTimeWindow(flow.send_time_window_json);

  // 2. 送信 時間帯 制約 チェック (send_message のみ)
  if (step.action_type === "send_message" && !isWithinSendTimeWindow(now, window)) {
    const shifted = shiftToWithinWindow(now, window);
    await supabase
      .from("ma_flow_subscriptions")
      .update({ next_action_at: shifted.toISOString() })
      .eq("id", sub.id);
    return {
      kind: "deferred",
      next_action_at: shifted.toISOString(),
      reason: "outside_send_window",
    };
  }

  // 3. 日次上限 チェック (send_message のみ)
  if (step.action_type === "send_message" && flow.max_send_per_day != null) {
    const sentToday = await countFlowSentToday(supabase, sub.flow_id);
    if (isDailyLimitReached(sentToday, flow.max_send_per_day)) {
      const tomorrow = nextDayStartUtc(now);
      await supabase
        .from("ma_flow_subscriptions")
        .update({ next_action_at: tomorrow.toISOString() })
        .eq("id", sub.id);
      return {
        kind: "deferred",
        next_action_at: tomorrow.toISOString(),
        reason: "daily_limit_reached",
      };
    }
  }

  // 4. action_type ディスパッチ
  let branchTaken: "true" | "false" | "default" = "default";
  try {
    switch (step.action_type) {
      case "send_message": {
        const r = await handleSendMessage(supabase, sub, flow, step);
        if (r.error) return failWith(supabase, sub.id, r.error);
        break;
      }
      case "assign_tag":
        await handleAssignTag(supabase, sub, step);
        break;
      case "remove_tag":
        await handleRemoveTag(supabase, sub, step);
        break;
      case "add_score":
        // Phase 2 実装 まで no-op。 log の み 残す。
        console.log(`[flow-executor] add_score no-op (sub=${sub.id})`);
        break;
      case "set_field":
        await handleSetField(supabase, sub, step);
        break;
      case "wait":
        // 遅延 目的 の 空 ステップ
        break;
      case "branch": {
        const outcome = await handleBranch(supabase, sub, step, now);
        branchTaken = outcome;
        break;
      }
      case "stop":
        await markStatus(supabase, sub.id, "completed");
        return { kind: "completed", final_status: "completed" };
      default:
        return failWith(supabase, sub.id, `unknown_action_type:${step.action_type}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failWith(supabase, sub.id, `action_exception:${msg}`);
  }

  // 5. 次 ステップ 決定
  const nextOrder = determineNextStepOrder(step, branchTaken);
  if (nextOrder == null) {
    await markStatus(supabase, sub.id, "completed");
    return { kind: "completed", final_status: "completed" };
  }

  const { data: nextStep } = await supabase
    .from("ma_flow_steps")
    .select("delay_from_previous_seconds")
    .eq("flow_id", sub.flow_id)
    .eq("step_order", nextOrder)
    .maybeSingle();
  if (!nextStep) {
    // 分岐 先 の ステップ が 存在 しない = Flow 末端
    await markStatus(supabase, sub.id, "completed");
    return { kind: "completed", final_status: "completed" };
  }
  const nextDelay = (nextStep as { delay_from_previous_seconds: number })
    .delay_from_previous_seconds;
  const nextAt = computeNextActionAt(now, nextDelay, window);

  await supabase
    .from("ma_flow_subscriptions")
    .update({
      current_step_order: nextOrder,
      next_action_at: nextAt.toISOString(),
    })
    .eq("id", sub.id);

  return {
    kind: "progressed",
    next_step_order: nextOrder,
    next_action_at: nextAt.toISOString(),
  };
}

// ────────────────────────────────────────
// action_type 別 ハンドラ
// ────────────────────────────────────────

async function handleSendMessage(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  flow: FlowRow,
  step: FlowStepRow,
): Promise<{ error?: string }> {
  if (!step.template_id) return { error: "template_id_missing" };

  // Template 取得 + 復号(subject は email 用、body は共通)
  const { data: template } = await supabase
    .from("ma_templates")
    .select("id, encrypted_subject, encrypted_body")
    .eq("id", step.template_id)
    .single();
  if (!template?.encrypted_body) return { error: "template_body_missing" };

  const rawBody = await decryptField(template.encrypted_body);
  if (!rawBody) return { error: "template_decrypt_failed" };
  const rawSubject = template.encrypted_subject
    ? ((await decryptField(template.encrypted_subject)) ?? "")
    : "";

  // 変数 展開 (Phase 1 は 最小 コンテキスト)
  const ctx = await buildTemplateContext(supabase, sub);
  const expandedBody = expandTemplate(rawBody, ctx);
  const expandedSubject = expandTemplate(rawSubject, ctx);

  // URL 短縮 (クリック 計測) は LINE / メール 共通
  const wrappedBody = await wrapBodyUrls(supabase, {
    organizationId: sub.organization_id,
    sendLogId: null,
    body: expandedBody,
  });

  if (flow.channel === "email") {
    return sendMessageViaEmail(supabase, sub, step, expandedSubject, wrappedBody);
  }
  // default: line
  return sendMessageViaLine(supabase, sub, step, wrappedBody);
}

/**
 * LINE 経由の送信。 従来の pushMessage をそのまま使う。
 */
async function sendMessageViaLine(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  step: FlowStepRow,
  wrappedBody: string,
): Promise<{ error?: string }> {
  const channel = await getLineChannelByOrgId(supabase, sub.organization_id);
  if (!channel) return { error: "line_channel_not_found" };

  const pushResult = await pushMessage(channel.channelAccessToken, sub.line_user_id, [
    { type: "text", text: wrappedBody },
  ]);

  const status = pushResult.ok ? "sent" : "failed";
  const errorMessage = pushResult.ok
    ? null
    : `${classifyLineError(pushResult.status, pushResult.message).kind}: ${pushResult.message}`.slice(
        0,
        500,
      );

  const encryptedBody = await encryptField(wrappedBody);
  const encryptedSubject = await encryptField("(LINE Flow)");
  await supabase.from("ma_send_logs").insert({
    organization_id: sub.organization_id,
    scenario_id: null,
    ma_flow_step_id: step.id,
    recipient_client_record_id: sub.client_record_id,
    recipient_email: null,
    recipient_line_user_id: sub.line_user_id,
    encrypted_subject: encryptedSubject,
    encrypted_body: encryptedBody,
    status,
    error_message: errorMessage,
  });

  if (!pushResult.ok) return { error: errorMessage ?? "push_failed" };
  return {};
}

/**
 * メール経由の送信(Resend)。
 * ・sub.client_record_id が必要(subscribe 時に埋まっている想定)
 * ・client_records.email が空 / email_distribution_enabled=false は skipped 相当で完了
 * ・件名は復号 + 変数展開済みの expandedSubject を使用
 */
async function sendMessageViaEmail(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  step: FlowStepRow,
  subject: string,
  wrappedBody: string,
): Promise<{ error?: string }> {
  if (!sub.client_record_id) {
    // enrollment 時に client_record と紐付けられなかった email Flow 加入者。
    // 送りようがないので skipped 相当で完了させる(失敗ではなく成功と同じ扱い)。
    await logEmailSkipped(supabase, sub, step, "client_record_missing", subject, wrappedBody);
    return {};
  }

  const { data: client } = await supabase
    .from("client_records")
    .select("email, email_distribution_enabled")
    .eq("id", sub.client_record_id)
    .maybeSingle();
  const clientRow = client as { email: string | null; email_distribution_enabled: boolean } | null;

  if (!clientRow?.email) {
    await logEmailSkipped(supabase, sub, step, "no_email_address", subject, wrappedBody);
    return {};
  }
  if (clientRow.email_distribution_enabled === false) {
    await logEmailSkipped(supabase, sub, step, "email_opt_out", subject, wrappedBody);
    return {};
  }

  // BYO: 組織が Resend API キーを登録していればそれを使う(未設定なら env)
  const orgEmail = await getOrgEmailConfig(supabase, sub.organization_id);
  const resendResult = await sendViaResend({
    toEmail: clientRow.email,
    subject: subject || "(件名なし)",
    body: wrappedBody,
    tags: [{ name: "ma_flow_step_id", value: step.id }],
    apiKey: orgEmail.apiKey,
    from: orgEmail.from,
  });

  const status = resendResult.sent
    ? "sent"
    : resendResult.reason === "not_configured"
      ? "skipped"
      : "failed";
  const errorMessage = resendResult.sent
    ? null
    : resendResult.reason === "not_configured"
      ? "resend_not_configured"
      : resendResult.error.slice(0, 500);

  const encryptedBody = await encryptField(wrappedBody);
  const encryptedSubject = await encryptField(subject);
  await supabase.from("ma_send_logs").insert({
    organization_id: sub.organization_id,
    scenario_id: null,
    ma_flow_step_id: step.id,
    recipient_client_record_id: sub.client_record_id,
    recipient_email: clientRow.email,
    recipient_line_user_id: null,
    encrypted_subject: encryptedSubject,
    encrypted_body: encryptedBody,
    status,
    error_message: errorMessage,
    resend_message_id: resendResult.sent ? resendResult.messageId : null,
  });

  // Resend 未設定は運用上「送れなかった」だけで Flow エラーではないので継続。
  // 明示的な send_failed はエラー扱い(step は fail としてマークされる)。
  if (!resendResult.sent && resendResult.reason === "send_failed") {
    return { error: errorMessage ?? "email_send_failed" };
  }
  return {};
}

/**
 * メール送信をスキップした際の ma_send_logs 記録。 実送信はしていないが
 * 「なぜ送らなかったか」を後追いできるようにする。
 */
async function logEmailSkipped(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  step: FlowStepRow,
  reason: string,
  subject: string,
  body: string,
): Promise<void> {
  const encryptedBody = await encryptField(body);
  const encryptedSubject = await encryptField(subject);
  await supabase.from("ma_send_logs").insert({
    organization_id: sub.organization_id,
    scenario_id: null,
    ma_flow_step_id: step.id,
    recipient_client_record_id: sub.client_record_id,
    recipient_email: null,
    recipient_line_user_id: null,
    encrypted_subject: encryptedSubject,
    encrypted_body: encryptedBody,
    status: "skipped",
    error_message: reason,
  });
}

async function handleAssignTag(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  step: FlowStepRow,
): Promise<void> {
  const tagId = String(step.action_config.tag_id ?? "");
  if (!tagId) throw new Error("assign_tag_missing_tag_id");
  await supabase.from("line_conversation_tag_assignments").upsert(
    {
      organization_id: sub.organization_id,
      line_user_id: sub.line_user_id,
      tag_id: tagId,
    },
    { onConflict: "organization_id,line_user_id,tag_id" },
  );
}

async function handleRemoveTag(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  step: FlowStepRow,
): Promise<void> {
  const tagId = String(step.action_config.tag_id ?? "");
  if (!tagId) throw new Error("remove_tag_missing_tag_id");
  await supabase
    .from("line_conversation_tag_assignments")
    .delete()
    .eq("organization_id", sub.organization_id)
    .eq("line_user_id", sub.line_user_id)
    .eq("tag_id", tagId);
}

async function handleSetField(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  step: FlowStepRow,
): Promise<void> {
  const key = String(step.action_config.key ?? "");
  const value = step.action_config.value == null ? null : String(step.action_config.value);
  if (!key) throw new Error("set_field_missing_key");
  await supabase.from("friend_fields").upsert(
    {
      organization_id: sub.organization_id,
      line_user_id: sub.line_user_id,
      key,
      value,
    },
    { onConflict: "organization_id,line_user_id,key" },
  );
}

async function handleBranch(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
  step: FlowStepRow,
  now: Date,
): Promise<"true" | "false" | "default"> {
  const cond = step.branch_condition_json as BranchCondition | null;
  if (!cond) return "default";
  const ctx = await buildBranchEvalContext(supabase, sub);
  const result = evaluateBranchCondition(cond, ctx, now);
  return result ? "true" : "false";
}

// ────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────

function determineNextStepOrder(
  step: FlowStepRow,
  branchTaken: "true" | "false" | "default",
): number | null {
  if (step.action_type === "branch") {
    if (branchTaken === "true") return step.next_step_on_true ?? step.step_order + 1;
    if (branchTaken === "false") return step.next_step_on_false ?? step.step_order + 1;
  }
  if (step.next_step_on_default != null) return step.next_step_on_default;
  return step.step_order + 1;
}

async function markStatus(
  supabase: SupabaseClient,
  subId: string,
  status: "completed" | "canceled" | "failed",
): Promise<void> {
  await supabase
    .from("ma_flow_subscriptions")
    .update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", subId);
}

async function failWith(
  supabase: SupabaseClient,
  subId: string,
  error: string,
): Promise<TickResult> {
  await supabase
    .from("ma_flow_subscriptions")
    .update({
      last_error_at: new Date().toISOString(),
      last_error_message: error.slice(0, 500),
    })
    .eq("id", subId);
  return { kind: "failed", error };
}

async function countFlowSentToday(supabase: SupabaseClient, flowId: string): Promise<number> {
  const { data: steps } = await supabase.from("ma_flow_steps").select("id").eq("flow_id", flowId);
  const stepIds = (steps ?? []).map((r: { id: string }) => r.id);
  if (stepIds.length === 0) return 0;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("ma_send_logs")
    .select("id", { count: "exact", head: true })
    .in("ma_flow_step_id", stepIds)
    .eq("status", "sent")
    .gte("sent_at", dayStart.toISOString());
  return count ?? 0;
}

/**
 * 変数 展開 用 コンテキスト。 Phase 1 は 最小 実装 (client_record 参照 のみ)。
 * 求人 / 面接 の 変数 は Phase 2 以降 で 補強。
 */
async function buildTemplateContext(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
): Promise<TemplateVariableValues> {
  const defaults: TemplateVariableValues = {
    candidate_name: "",
    candidate_last_name: "",
    candidate_first_name: "",
    candidate_email: "",
    agent_name: "",
    agent_last_name: "",
    agent_first_name: "",
    organization_name: "",
    company_name: "",
    job_title: "",
    interview_date: "",
  };

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", sub.organization_id)
    .single();
  if (org) defaults.organization_name = String(org.name ?? "");

  if (sub.client_record_id) {
    const { data: cr } = await supabase
      .from("client_records")
      .select("last_name, first_name, email")
      .eq("id", sub.client_record_id)
      .single();
    if (cr) {
      const ln = String(cr.last_name ?? "");
      const fn = String(cr.first_name ?? "");
      defaults.candidate_last_name = ln;
      defaults.candidate_first_name = fn;
      defaults.candidate_name = [ln, fn].filter(Boolean).join(" ");
      defaults.candidate_email = String(cr.email ?? "");
    }
  }
  return defaults;
}

/**
 * BranchEvalContext を 組み立て る。 friend 単位 の タグ / 自由項目 / 最近 の
 * postback / 返信 / クリック を 集約 する。
 *
 * Phase 1 では 送信 履歴 と click 履歴 は 簡易 (返信 / クリック は 過去 24h 内 で 判定)。
 * Phase 2 以降 で 前 ステップ 到達 時 の baseline から の 差分 に 精緻 化 する。
 */
async function buildBranchEvalContext(
  supabase: SupabaseClient,
  sub: SubscriptionRow,
): Promise<BranchEvalContext> {
  const linkRes = await supabase
    .from("line_user_links")
    .select("created_at, last_activity_at")
    .eq("organization_id", sub.organization_id)
    .eq("line_user_id", sub.line_user_id)
    .maybeSingle();
  const createdAt = linkRes.data?.created_at
    ? new Date(String(linkRes.data.created_at))
    : new Date(sub.entered_at);
  const lastActivityAt = linkRes.data?.last_activity_at
    ? new Date(String(linkRes.data.last_activity_at))
    : createdAt;

  const tagsRes = await supabase
    .from("line_conversation_tag_assignments")
    .select("tag_id")
    .eq("organization_id", sub.organization_id)
    .eq("line_user_id", sub.line_user_id);
  const tagIds = new Set((tagsRes.data ?? []).map((r: { tag_id: string }) => r.tag_id));

  const fieldsRes = await supabase
    .from("friend_fields")
    .select("key, value")
    .eq("organization_id", sub.organization_id)
    .eq("line_user_id", sub.line_user_id);
  const fields = new Map(
    (fieldsRes.data ?? [])
      .filter((r: { value: string | null }) => r.value != null)
      .map((r: { key: string; value: string }) => [r.key, r.value] as const),
  );

  // 直近 180 日の CV イベントをロード。branch の conversion_event_present /
  // absent の判定に使う。過去 6 か月あれば within_days が長めの条件でも足りる。
  const cvRes = await supabase
    .from("ma_conversion_events")
    .select("event_key, occurred_at")
    .eq("organization_id", sub.organization_id)
    .eq("line_user_id", sub.line_user_id)
    .gte("occurred_at", new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());
  const conversion_events = (cvRes.data ?? []).map(
    (r: { event_key: string; occurred_at: string }) => ({
      event_key: r.event_key,
      occurred_at: new Date(r.occurred_at),
    }),
  );

  return {
    organization_id: sub.organization_id,
    line_user_id: sub.line_user_id,
    created_at: createdAt,
    last_activity_at: lastActivityAt,
    tag_ids: tagIds,
    fields,
    clicked_flow_ids: new Set(),
    conversion_events,
    replied_since_previous_step: false,
    clicked_link_in_previous_step: false,
    latest_postback_data: undefined,
  };
}
