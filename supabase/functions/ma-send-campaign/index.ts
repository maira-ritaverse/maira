/**
 * MA 自動配信 Edge Function(Phase C-3 MVP)
 *
 * 起動経路:
 *   - pg_cron(本番運用時)→ net.http_post でこの URL を叩く
 *   - 開発時:`supabase functions invoke ma-send-campaign` または curl で手動 invoke
 *
 * 処理フロー:
 *   1. 全組織を横断:ma_scenarios の is_active=true な行を取得
 *   2. シナリオごとに同意状態(ma_consent_log)を確認 → 撤回済みは skip
 *   3. 実装済みシナリオキーに対して、判定ロジックで対象 client_records を抽出
 *   4. テンプレート(ma_templates)を復号
 *   5. 各候補について:
 *      - 変数展開(担当アドバイザー名・組織名等を埋める)
 *      - Resend で送信(キー未設定なら skipped でログ)
 *      - ma_send_logs に記録(件名・本文は暗号化)
 *   6. レスポンスで処理件数・失敗件数を返す
 *
 * セキュリティ:
 *   - service_role キーで RLS bypass(本 Function は service_role 前提)
 *   - 暗号化鍵は Supabase Secrets に設定(FIELD_ENCRYPTION_KEYS)
 *   - リクエストはオプションで Bearer ヘッダ(SUPABASE_SERVICE_ROLE_KEY)で認証
 *     (pg_cron からは net.http_post で同キーを送る)
 *
 * MVP の意図的な制限:
 *   - リトライは行わない(失敗 = ma_send_logs に status='failed' で 1 行残す)
 *   - 1 シナリオあたりの上限は無し(MVP 段階。将来 max_per_run 設定を追加)
 *   - 送信間隔の制御無し(Resend のレート制限内で順次送る)
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wrapBodyUrls } from "./click-tracking.ts";
import { decryptField, encryptField } from "./field-encryption.ts";
import { sendViaResend } from "./resend.ts";
import { expandSubjectAndBody, type VariableContext } from "./template-expander.ts";
import {
  findAfterInterviewFollowupCandidates,
  findBirthdayGreetingCandidates,
  findDormantOutreachCandidates,
  findJobIntroductionCandidates,
  findMeetingReminderCandidates,
  findPostPlacementFollowupCandidates,
  findRegisterMeetingPromotionCandidates,
  type CandidateRow,
} from "./scenarios.ts";

// Edge Function 側で「判定ロジックを実装済み」のシナリオキー。
// Web 側 `lib/ma/types.ts` の IMPLEMENTED_SCENARIO_KEYS と同期させる。
const IMPLEMENTED_SCENARIO_KEYS = [
  "register_meeting_promotion",
  "dormant_outreach",
  "meeting_reminder",
  "job_introduction",
  "after_interview_followup",
  "post_placement_followup",
  "birthday_greeting",
] as const;
type ImplementedKey = (typeof IMPLEMENTED_SCENARIO_KEYS)[number];

type ScenarioRow = {
  id: string;
  organization_id: string;
  is_active: boolean;
  trigger_days_override: number | null;
  preset: {
    key: string;
    default_trigger_days: number;
    name: string;
    audience: string;
    channel: string;
  };
};

type RunStats = {
  scenarios_processed: number;
  candidates_found: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

Deno.serve(async (req) => {
  // 認証:pg_cron からは Authorization: Bearer <SERVICE_ROLE_KEY> で叩く想定。
  // ローカルからの手動 invoke でも Supabase CLI が自動でヘッダを付与する。
  const auth = req.headers.get("Authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`;
  if (!auth || auth !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  // service_role クライアント(RLS bypass)
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stats: RunStats = {
    scenarios_processed: 0,
    candidates_found: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    // 1) 有効化された全シナリオを取得(プリセット情報も join で取る)
    const { data: scenarios, error: sErr } = await supabase
      .from("ma_scenarios")
      .select(
        "id, organization_id, is_active, trigger_days_override, preset:ma_scenario_presets(key, default_trigger_days, name, audience, channel)",
      )
      .eq("is_active", true);
    if (sErr) throw new Error(`ma_scenarios 取得失敗: ${sErr.message}`);
    if (!scenarios || scenarios.length === 0) {
      return new Response(JSON.stringify({ stats, message: "No active scenarios" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // 組織ごとの「name」と「同意状態」をキャッシュ(同一組織で複数シナリオを処理するため)
    const orgNameCache = new Map<string, string>();
    const consentCache = new Map<string, boolean>();

    for (const rawScenario of scenarios) {
      // preset は Resource Embedding により配列で返ることがあるため正規化
      const presetRaw = rawScenario.preset as unknown;
      const preset = Array.isArray(presetRaw)
        ? (presetRaw[0] as ScenarioRow["preset"] | undefined)
        : (presetRaw as ScenarioRow["preset"] | undefined);
      if (!preset) continue;

      const scenario: ScenarioRow = {
        id: rawScenario.id,
        organization_id: rawScenario.organization_id,
        is_active: rawScenario.is_active,
        trigger_days_override: rawScenario.trigger_days_override,
        preset,
      };

      // 実装済みシナリオキーのみ処理
      if (!(IMPLEMENTED_SCENARIO_KEYS as readonly string[]).includes(scenario.preset.key)) {
        continue;
      }
      const presetKey = scenario.preset.key as ImplementedKey;

      stats.scenarios_processed++;

      // 2) 同意状態チェック(email_ma 機能の有効同意があるか)
      let hasConsent = consentCache.get(scenario.organization_id);
      if (hasConsent === undefined) {
        const { data: consentRow, error: cErr } = await supabase
          .from("ma_consent_log")
          .select("id")
          .eq("organization_id", scenario.organization_id)
          .eq("feature", "email_ma")
          .is("revoked_at", null)
          .limit(1)
          .maybeSingle();
        if (cErr) {
          stats.errors.push(`consent 取得失敗(org=${scenario.organization_id}): ${cErr.message}`);
          continue;
        }
        hasConsent = !!consentRow;
        consentCache.set(scenario.organization_id, hasConsent);
      }
      if (!hasConsent) continue; // 撤回済み or 未同意 → 配信しない

      // 3) シナリオ判定ロジックで対象 client_records を抽出
      const triggerDays = scenario.trigger_days_override ?? scenario.preset.default_trigger_days;
      let candidates: CandidateRow[] = [];
      try {
        if (presetKey === "register_meeting_promotion") {
          candidates = await findRegisterMeetingPromotionCandidates(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            days: triggerDays,
          });
        } else if (presetKey === "dormant_outreach") {
          candidates = await findDormantOutreachCandidates(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            days: triggerDays,
          });
        } else if (presetKey === "meeting_reminder") {
          candidates = await findMeetingReminderCandidates(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            days: triggerDays,
          });
        } else if (presetKey === "job_introduction") {
          candidates = await findJobIntroductionCandidates(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            days: triggerDays,
          });
        } else if (presetKey === "after_interview_followup") {
          candidates = await findAfterInterviewFollowupCandidates(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            days: triggerDays,
          });
        } else if (presetKey === "post_placement_followup") {
          candidates = await findPostPlacementFollowupCandidates(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            days: triggerDays,
          });
        } else if (presetKey === "birthday_greeting") {
          // 起点 は MM-DD なので triggerDays は 無視 (誕生日 当日 のみ)
          candidates = await findBirthdayGreetingCandidates(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
          });
        }
      } catch (err) {
        stats.errors.push(
          `判定失敗(${presetKey}): ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      stats.candidates_found += candidates.length;
      if (candidates.length === 0) continue;

      // 4) テンプレート取得 + 復号
      const { data: tplRow, error: tErr } = await supabase
        .from("ma_templates")
        .select("encrypted_subject, encrypted_body")
        .eq("scenario_id", scenario.id)
        .maybeSingle();
      if (tErr) {
        stats.errors.push(`template 取得失敗(${presetKey}): ${tErr.message}`);
        continue;
      }
      if (!tplRow?.encrypted_subject || !tplRow?.encrypted_body) {
        // テンプレ未編集 → 送信しない(空メールを送るより安全側に倒す)
        for (const c of candidates) {
          await writeLog(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            recipientClientRecordId: c.clientRecordId,
            recipientEmail: c.clientEmail,
            subject: "",
            body: "",
            status: "skipped",
            errorMessage: "テンプレート未設定",
          });
          stats.skipped++;
        }
        continue;
      }

      let subjectTemplate: string;
      let bodyTemplate: string;
      try {
        subjectTemplate = (await decryptField(tplRow.encrypted_subject)) ?? "";
        bodyTemplate = (await decryptField(tplRow.encrypted_body)) ?? "";
      } catch (err) {
        stats.errors.push(
          `テンプレ復号失敗(${presetKey}): ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      // 組織名キャッシュ
      let orgName = orgNameCache.get(scenario.organization_id);
      if (orgName === undefined) {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", scenario.organization_id)
          .maybeSingle();
        orgName = orgRow?.name ?? "";
        orgNameCache.set(scenario.organization_id, orgName);
      }

      // 5) 候補ごとに変数展開して送信
      for (const c of candidates) {
        // 担当アドバイザー名は organization_members → auth.users まで辿る必要があるが、
        // Phase C-3 MVP では organization_members.id だけ持ち、表示は空に倒す。
        // 将来 RPC `get_member_display_name` を作って埋める。
        const ctx: VariableContext = {
          candidate_name: c.clientName,
          candidate_last_name: c.clientName.split(/\s+/)[0] ?? c.clientName,
          candidate_first_name: c.clientName.split(/\s+/)[1] ?? "",
          candidate_email: c.clientEmail,
          agent_name: "",
          agent_last_name: "",
          agent_first_name: "",
          organization_name: orgName,
        };
        const { subject, body } = expandSubjectAndBody(subjectTemplate, bodyTemplate, ctx);

        // 本文 内 URL を トラッキング 短縮 URL に 置換 (クリック 計測)
        const siteUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") ?? "https://www.maira.pro").replace(
          /\/$/,
          "",
        );
        const trackedBody = await wrapBodyUrls(supabase, {
          organizationId: scenario.organization_id,
          body,
          siteUrl,
        });

        const sendResult = await sendViaResend({
          toEmail: c.clientEmail,
          subject,
          body: trackedBody,
          tags: [{ name: "scenario", value: presetKey }],
        });

        if (sendResult.sent) {
          await writeLog(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            recipientClientRecordId: c.clientRecordId,
            recipientEmail: c.clientEmail,
            subject,
            body: trackedBody,
            status: "sent",
            resendMessageId: sendResult.messageId,
          });
          stats.sent++;
        } else if (sendResult.reason === "not_configured") {
          await writeLog(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            recipientClientRecordId: c.clientRecordId,
            recipientEmail: c.clientEmail,
            subject,
            body,
            status: "skipped",
            errorMessage: "RESEND_API_KEY または EMAIL_FROM 未設定",
          });
          stats.skipped++;
        } else {
          await writeLog(supabase, {
            organizationId: scenario.organization_id,
            scenarioId: scenario.id,
            recipientClientRecordId: c.clientRecordId,
            recipientEmail: c.clientEmail,
            subject,
            body,
            status: "failed",
            errorMessage: sendResult.error ?? "unknown error",
          });
          stats.failed++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, stats }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Internal error",
        message: err instanceof Error ? err.message : String(err),
        stats,
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});

/**
 * ma_send_logs に 1 行追加するヘルパー。
 * 件名・本文は暗号化してから保存する。
 */
async function writeLog(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    scenarioId: string;
    recipientClientRecordId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    status: "sent" | "failed" | "skipped";
    errorMessage?: string;
    resendMessageId?: string | null;
  },
): Promise<void> {
  const [encSubject, encBody] = await Promise.all([
    encryptField(input.subject || "(空)"),
    encryptField(input.body || "(空)"),
  ]);
  const { error } = await supabase.from("ma_send_logs").insert({
    organization_id: input.organizationId,
    scenario_id: input.scenarioId,
    recipient_client_record_id: input.recipientClientRecordId,
    recipient_email: input.recipientEmail,
    encrypted_subject: encSubject,
    encrypted_body: encBody,
    status: input.status,
    error_message: input.errorMessage ?? null,
    resend_message_id: input.resendMessageId ?? null,
  });
  // ログ自体の書き込み失敗はクリティカルだが、Function 全体を止める価値は薄い。
  // console.error で残して次の候補へ進む。
  if (error) {
    console.error("ma_send_logs insert failed:", error.message);
  }
}
