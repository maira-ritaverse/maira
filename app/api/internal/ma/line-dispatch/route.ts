import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { pushMessage } from "@/lib/line/api";
import { classifyLineError } from "@/lib/line/errors";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { expandTemplate, type TemplateVariableValues } from "@/lib/ma/test-send";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST/GET /api/internal/ma/line-dispatch
 *
 * LINE MA 自動 配信 cron。 1 分 ごと 起動 想定。
 *
 * 処理 フロー:
 *   1. ma_scenarios で channel='line' か つ is_active=true な 行 を 取得
 *   2. シナリオ ごと に line_ma 同意 を 確認 (撤回 済 は skip)
 *   3. シナリオ キー で 候補 line_user_id を 抽出
 *      ・line_welcome_after_friend: 友達 追加 から N 日 以上 経過 で 未送信
 *      ・line_dormant_outreach:     最終 inbound から N 日 以上 経過 で 未送信
 *   4. テンプレート (ma_templates) を 復号 → 変数 展開
 *   5. push API で 送信、 ma_send_logs に 記録
 *
 * MVP の 意図的 制限:
 *   ・1 tick で 1 シナリオ あたり 最大 50 ユーザー
 *   ・連続 quota_exceeded を 検出 した ら 早期 break
 *   ・リトライ なし (失敗 = ma_send_logs に status='failed' を 1 行 残す)
 */
const MAX_PER_SCENARIO = 50;

type ScenarioRow = {
  id: string;
  organization_id: string;
  preset_id: string;
  trigger_days_override: number | null;
  ma_scenario_presets: { key: string; default_trigger_days: number; name: string } | null;
};

type TemplateRow = {
  scenario_id: string;
  encrypted_subject: string;
  encrypted_body: string;
};

type OrgRow = { id: string; name: string };

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json(
        { error: "CRON_SECRET / INTAKE_CRON_SECRET 未設定" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();

  // is_active=true な LINE channel シナリオ を 取得
  const { data: scenarioRows } = await admin
    .from("ma_scenarios")
    .select(
      "id, organization_id, preset_id, trigger_days_override, ma_scenario_presets(key, default_trigger_days, name)",
    )
    .eq("is_active", true);
  const scenarios = (scenarioRows ?? []) as unknown as ScenarioRow[];
  const lineScenarios = scenarios.filter(
    (s) =>
      s.ma_scenario_presets?.key === "line_welcome_after_friend" ||
      s.ma_scenario_presets?.key === "line_dormant_outreach",
  );
  if (lineScenarios.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: "no_active_line_scenarios" });
  }

  // 関連 org の line_ma 同意 を 一括 確認
  const orgIds = Array.from(new Set(lineScenarios.map((s) => s.organization_id)));
  const { data: consents } = await admin
    .from("ma_consent_log")
    .select("organization_id, revoked_at")
    .eq("feature", "line_ma")
    .in("organization_id", orgIds)
    .is("revoked_at", null);
  const consentedOrgs = new Set(
    ((consents ?? []) as Array<{ organization_id: string }>).map((c) => c.organization_id),
  );

  // org 名 取得 (テンプレ 変数 用)
  const { data: orgRows } = await admin.from("organizations").select("id, name").in("id", orgIds);
  const orgNameMap = new Map(((orgRows ?? []) as OrgRow[]).map((o) => [o.id, o.name]));

  // テンプレ を 一括 取得
  const scenarioIds = lineScenarios.map((s) => s.id);
  const { data: templateRows } = await admin
    .from("ma_templates")
    .select("scenario_id, encrypted_subject, encrypted_body")
    .in("scenario_id", scenarioIds);
  const templateMap = new Map(
    ((templateRows ?? []) as TemplateRow[]).map((t) => [t.scenario_id, t]),
  );

  let totalSent = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const scenario of lineScenarios) {
    const presetKey = scenario.ma_scenario_presets?.key;
    if (!presetKey) continue;
    if (!consentedOrgs.has(scenario.organization_id)) {
      // 未同意: skipped で 抜ける (ログ には 残さ ない — 件数 過多 を 防ぐ)
      continue;
    }

    const channel = await getLineChannelByOrgId(admin, scenario.organization_id);
    if (!channel) {
      totalSkipped++;
      continue;
    }

    const template = templateMap.get(scenario.id);
    if (!template) {
      totalSkipped++;
      continue;
    }
    const subject = (await decryptField(template.encrypted_subject)) ?? "";
    const body = (await decryptField(template.encrypted_body)) ?? "";
    if (!body) {
      totalSkipped++;
      continue;
    }

    const triggerDays =
      scenario.trigger_days_override ?? scenario.ma_scenario_presets!.default_trigger_days;

    const candidates = await findLineCandidates(admin, {
      scenarioId: scenario.id,
      organizationId: scenario.organization_id,
      presetKey,
      triggerDays,
    });

    for (const cand of candidates.slice(0, MAX_PER_SCENARIO)) {
      // 変数 展開
      const ctx: TemplateVariableValues = {
        candidate_name: cand.displayName ?? "",
        candidate_last_name: "",
        candidate_first_name: "",
        candidate_email: "",
        agent_name: "",
        agent_last_name: "",
        agent_first_name: "",
        organization_name: orgNameMap.get(scenario.organization_id) ?? "",
        company_name: "",
        job_title: "",
        interview_date: "",
      };
      const expandedBody = expandTemplate(body, ctx);

      // LINE push 送信
      const sendResult = await pushMessage(channel.channelAccessToken, cand.lineUserId, [
        { type: "text", text: expandedBody },
      ]);

      // ma_send_logs へ 1 行 記録
      const encSubj = (await encryptField(subject)) ?? "";
      const encBody = (await encryptField(expandedBody)) ?? "";
      if (sendResult.ok) {
        totalSent++;
        await admin.from("ma_send_logs").insert({
          organization_id: scenario.organization_id,
          scenario_id: scenario.id,
          recipient_client_record_id: cand.clientRecordId,
          recipient_line_user_id: cand.lineUserId,
          recipient_email: null,
          encrypted_subject: encSubj,
          encrypted_body: encBody,
          status: "sent",
          resend_message_id: null,
        });
      } else {
        const cls = classifyLineError(sendResult.status, sendResult.message);
        totalFailed++;
        await admin.from("ma_send_logs").insert({
          organization_id: scenario.organization_id,
          scenario_id: scenario.id,
          recipient_client_record_id: cand.clientRecordId,
          recipient_line_user_id: cand.lineUserId,
          recipient_email: null,
          encrypted_subject: encSubj,
          encrypted_body: encBody,
          status: "failed",
          error_message: `${cls.kind}: ${cls.message}`,
        });
        if (cls.kind === "quota_exceeded" || cls.kind === "unauthorized") {
          // この org の 残り 候補 は 早期 break (続けても 全滅 する)
          break;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed: lineScenarios.length,
    totalSent,
    totalFailed,
    totalSkipped,
  });
}

export const GET = POST;

// ============================================
// 候補 抽出 ロジック
// ============================================

type Candidate = {
  lineUserId: string;
  clientRecordId: string | null;
  displayName: string | null;
};

type AdminClient = ReturnType<typeof createServiceClient>;

async function findLineCandidates(
  admin: AdminClient,
  args: {
    scenarioId: string;
    organizationId: string;
    presetKey: string;
    triggerDays: number;
  },
): Promise<Candidate[]> {
  if (args.presetKey === "line_welcome_after_friend") {
    return await findWelcomeCandidates(admin, args);
  }
  if (args.presetKey === "line_dormant_outreach") {
    return await findDormantCandidates(admin, args);
  }
  return [];
}

/**
 * 友達 追加 から triggerDays 日 以上 経過、 かつ 当 シナリオ で
 * 未送信 (ma_send_logs に 同 scenario_id × line_user_id が ない) の 友達 を 返す。
 */
async function findWelcomeCandidates(
  admin: AdminClient,
  args: { scenarioId: string; organizationId: string; triggerDays: number },
): Promise<Candidate[]> {
  const threshold = new Date(Date.now() - args.triggerDays * 86400_000).toISOString();
  const { data: links } = await admin
    .from("line_user_links")
    .select("line_user_id, client_record_id, display_name, friend_added_at, created_at")
    .eq("organization_id", args.organizationId)
    .is("unfollowed_at", null)
    .lte("created_at", threshold)
    .limit(200);
  type LinkRow = {
    line_user_id: string;
    client_record_id: string | null;
    display_name: string | null;
  };
  const allLinks = (links ?? []) as LinkRow[];
  if (allLinks.length === 0) return [];

  // 既送信 を 除外
  const lineUserIds = allLinks.map((l) => l.line_user_id);
  const { data: sentLogs } = await admin
    .from("ma_send_logs")
    .select("recipient_line_user_id")
    .eq("scenario_id", args.scenarioId)
    .in("recipient_line_user_id", lineUserIds);
  const sent = new Set(
    ((sentLogs ?? []) as Array<{ recipient_line_user_id: string }>).map(
      (l) => l.recipient_line_user_id,
    ),
  );
  return allLinks
    .filter((l) => !sent.has(l.line_user_id))
    .map((l) => ({
      lineUserId: l.line_user_id,
      clientRecordId: l.client_record_id,
      displayName: l.display_name,
    }));
}

/**
 * 最終 inbound メッセージ から triggerDays 日 以上 経過 した 友達 を 返す。
 * 同 シナリオ で 過去 30 日 以内 に 送信 済 の 場合 は スキップ (連続 送信 防止)。
 */
async function findDormantCandidates(
  admin: AdminClient,
  args: { scenarioId: string; organizationId: string; triggerDays: number },
): Promise<Candidate[]> {
  const threshold = new Date(Date.now() - args.triggerDays * 86400_000).toISOString();
  const cooldown = new Date(Date.now() - 30 * 86400_000).toISOString();

  // 該当 org の 全 友達 + 最終 inbound 日時 を 個別 取得
  const { data: links } = await admin
    .from("line_user_links")
    .select("line_user_id, client_record_id, display_name")
    .eq("organization_id", args.organizationId)
    .is("unfollowed_at", null)
    .limit(500);
  type LinkRow = {
    line_user_id: string;
    client_record_id: string | null;
    display_name: string | null;
  };
  const allLinks = (links ?? []) as LinkRow[];
  if (allLinks.length === 0) return [];

  // 各 友達 の 最終 inbound created_at を 取得 (N+1 — 友達 数 ≤ 500 想定 で 許容)
  const candidates: Candidate[] = [];
  for (const l of allLinks) {
    const { data: lastInbound } = await admin
      .from("line_messages")
      .select("created_at")
      .eq("organization_id", args.organizationId)
      .eq("line_user_id", l.line_user_id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = (lastInbound as { created_at: string } | null)?.created_at;
    if (!lastAt) continue;
    if (lastAt > threshold) continue;

    // 30 日 cooldown
    const { data: recentLog } = await admin
      .from("ma_send_logs")
      .select("id")
      .eq("scenario_id", args.scenarioId)
      .eq("recipient_line_user_id", l.line_user_id)
      .gte("sent_at", cooldown)
      .limit(1)
      .maybeSingle();
    if (recentLog) continue;

    candidates.push({
      lineUserId: l.line_user_id,
      clientRecordId: l.client_record_id,
      displayName: l.display_name,
    });
  }
  return candidates;
}
