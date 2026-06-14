/**
 * テスト送信ヘルパー(Web 側)
 *
 * 管理画面の「テスト送信」ボタンから 1 通だけ送る用途。
 *
 *   - シナリオ判定ロジック・同意撤回チェック・重複送信防止は **行わない**
 *     (テストなので意図的に毎回送れる)
 *   - 変数展開は Edge Function 側 template-expander と同じセマンティクス
 *     (キーが揃わない値は空文字、未知キーは `{{xxx}}` のまま残す)
 *   - 送信結果は ma_send_logs に admin INSERT で記録(マイグレーション 20260615000003)
 *   - Resend API キー未設定なら no-op で status='skipped' を残す
 *     → DNS 整備前でも UI 操作と DB 記録の動作確認ができる
 */

import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";

export type TestSendInput = {
  organizationId: string;
  scenarioId: string;
  // 送信先(初期値は呼び出し元 admin の自分のメアド)
  recipientEmail: string;
  // 変数オーバーライド(候補者名等を任意に差し替えたい場合)。未指定なら admin 由来のデフォルトを使う。
  variableOverrides?: Partial<TemplateVariableValues>;
};

export type TestSendResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed" | "template_missing"; error?: string };

export type TemplateVariableValues = {
  candidate_name: string;
  candidate_last_name: string;
  candidate_first_name: string;
  candidate_email: string;
  agent_name: string;
  agent_last_name: string;
  agent_first_name: string;
  organization_name: string;
  company_name: string;
  job_title: string;
  interview_date: string;
};

const DEFAULT_TEST_VALUES: TemplateVariableValues = {
  candidate_name: "山田 太郎",
  candidate_last_name: "山田",
  candidate_first_name: "太郎",
  candidate_email: "candidate@example.com",
  agent_name: "(担当者名)",
  agent_last_name: "(姓)",
  agent_first_name: "(名)",
  organization_name: "(組織名)",
  company_name: "(企業名)",
  job_title: "(求人名)",
  interview_date: "2026/06/20",
};

/**
 * テンプレート文字列内の `{{key}}` を ctx の値で置換する。
 * Edge Function 側 template-expander.ts と同じセマンティクス。
 *
 * 仕様:
 *   - 既知キーのみ置換(未知キーは `{{xxx}}` のまま残す = 運用ミス検知)
 *   - 値が空文字なら空文字に置換(「(未設定)」のようなプレースホルダは出さない)
 *   - 同じキーが複数回出てきても全部置換(g フラグ)
 *
 * テストしやすいよう export(unit test から import)。
 */
export function expandTemplate(template: string, ctx: TemplateVariableValues): string {
  const allowed = new Set(Object.keys(ctx));
  return template.replace(/\{\{(\w+)\}\}/g, (match, rawKey: string) => {
    if (!allowed.has(rawKey)) return match;
    return ctx[rawKey as keyof TemplateVariableValues] ?? "";
  });
}

/**
 * Resend HTTP API 直叩き(Web 側既存パターン lib/email/invitation.ts と同じ)
 */
async function sendViaResend(args: {
  toEmail: string;
  subject: string;
  body: string;
  scenarioKey: string;
}): Promise<TestSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.toEmail],
        subject: `[テスト送信] ${args.subject}`,
        text: args.body,
        tags: [{ name: "test_send", value: args.scenarioKey }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        sent: false,
        reason: "send_failed",
        error: `HTTP ${res.status}: ${body.slice(0, 500)}`,
      };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, messageId: data.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * テスト送信本体。
 *
 * 流れ:
 *   1. シナリオ + プリセット情報を取得(自組織のみ)
 *   2. テンプレートを取得+復号 → 未設定なら template_missing
 *   3. 変数展開(デフォルト値 + オーバーライド)
 *   4. Resend 送信(キー未設定なら skipped)
 *   5. ma_send_logs に暗号化して記録
 */
export async function sendTestEmail(input: TestSendInput): Promise<TestSendResult> {
  const supabase = await createClient();

  // 1) シナリオ + プリセット
  const { data: scenarioRow, error: sErr } = await supabase
    .from("ma_scenarios")
    .select("id, preset:ma_scenario_presets(key, name)")
    .eq("id", input.scenarioId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (sErr) throw new Error(`シナリオ取得失敗: ${sErr.message}`);
  if (!scenarioRow) {
    return { sent: false, reason: "template_missing", error: "シナリオが見つかりません" };
  }
  const presetRaw = scenarioRow.preset as unknown;
  const preset = Array.isArray(presetRaw)
    ? (presetRaw[0] as { key: string; name: string } | undefined)
    : (presetRaw as { key: string; name: string } | undefined);
  if (!preset) {
    return { sent: false, reason: "template_missing", error: "プリセット情報が取得できません" };
  }

  // 2) テンプレート取得+復号
  const { data: tplRow, error: tErr } = await supabase
    .from("ma_templates")
    .select("encrypted_subject, encrypted_body")
    .eq("scenario_id", input.scenarioId)
    .maybeSingle();
  if (tErr) throw new Error(`テンプレ取得失敗: ${tErr.message}`);
  if (!tplRow?.encrypted_subject || !tplRow?.encrypted_body) {
    return {
      sent: false,
      reason: "template_missing",
      error: "テンプレートが未保存です。先にテンプレート編集で件名・本文を保存してください。",
    };
  }
  const subjectTpl = (await decryptField(tplRow.encrypted_subject)) ?? "";
  const bodyTpl = (await decryptField(tplRow.encrypted_body)) ?? "";

  // 3) 変数展開
  const ctx: TemplateVariableValues = {
    ...DEFAULT_TEST_VALUES,
    candidate_email: input.recipientEmail, // 送信先を candidate_email に反映
    ...input.variableOverrides,
  };
  const subject = expandTemplate(subjectTpl, ctx);
  const body = expandTemplate(bodyTpl, ctx);

  // 4) Resend 送信
  const sendResult = await sendViaResend({
    toEmail: input.recipientEmail,
    subject,
    body,
    scenarioKey: preset.key,
  });

  // 5) ma_send_logs に記録(admin INSERT、admin 認可は API ルート側で済ませている前提)
  const [encSubject, encBody] = await Promise.all([
    encryptField(subject || "(空)"),
    encryptField(body || "(空)"),
  ]);
  const status: "sent" | "failed" | "skipped" = sendResult.sent
    ? "sent"
    : sendResult.reason === "not_configured"
      ? "skipped"
      : "failed";
  const errorMessage = sendResult.sent
    ? null
    : sendResult.reason === "not_configured"
      ? "RESEND_API_KEY または EMAIL_FROM 未設定(テスト送信)"
      : (sendResult.error ?? "unknown");

  const { error: logErr } = await supabase.from("ma_send_logs").insert({
    organization_id: input.organizationId,
    scenario_id: input.scenarioId,
    recipient_client_record_id: null, // テスト送信は client_record に紐づかない
    recipient_email: input.recipientEmail,
    encrypted_subject: encSubject,
    encrypted_body: encBody,
    status,
    error_message: errorMessage,
    resend_message_id: sendResult.sent ? sendResult.messageId : null,
  });
  if (logErr) {
    // ログ書き込み失敗はクリティカル(監査ログ漏れ)。呼び出し側へ throw して 500 を返してもらう。
    throw new Error(`ma_send_logs 書き込み失敗: ${logErr.message}`);
  }

  return sendResult;
}
