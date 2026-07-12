import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { pushMessage } from "@/lib/line/api";
import { classifyLineError } from "@/lib/line/errors";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { wrapBodyUrls } from "@/lib/ma/click-tracking";
import { getOrgIdsByDispatchEngine } from "@/lib/ma/dispatch-flag";
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
  const LINE_KEYS = new Set([
    "line_welcome_after_friend",
    "line_dormant_outreach",
    "line_register_meeting_promotion",
    "line_meeting_reminder",
    "line_job_introduction",
    "line_after_interview_followup",
    "line_birthday_greeting",
  ]);
  const lineScenariosBeforeEngineFilter = scenarios.filter(
    (s) => s.ma_scenario_presets?.key && LINE_KEYS.has(s.ma_scenario_presets.key),
  );

  // Phase 1 P1-D カットオーバー:organizations.ma_dispatch_engine='new' の org は
  // 新 flow-dispatch cron が 担当 する ので、 旧 line-dispatch は 対象外 に する。
  // 参照:docs/line-lstep-ma-phase1-plan.md §4.4
  const newEngineOrgs = await getOrgIdsByDispatchEngine(admin, "new");
  const lineScenarios = lineScenariosBeforeEngineFilter.filter(
    (s) => !newEngineOrgs.has(s.organization_id),
  );

  if (lineScenarios.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      message: "no_active_line_scenarios",
      skipped_by_new_engine: lineScenariosBeforeEngineFilter.length - lineScenarios.length,
    });
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

      // 本文 内 の URL を トラッキング 短縮 URL に 置換 (クリック 計測 用)
      const trackedBody = await wrapBodyUrls(admin, {
        organizationId: scenario.organization_id,
        body: expandedBody,
      });

      // LINE push 送信
      const sendResult = await pushMessage(channel.channelAccessToken, cand.lineUserId, [
        { type: "text", text: trackedBody },
      ]);

      // ma_send_logs へ 1 行 記録 (本文 は トラッキング 済 を 保存)
      const encSubj = (await encryptField(subject)) ?? "";
      const encBody = (await encryptField(trackedBody)) ?? "";
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
  if (args.presetKey === "line_welcome_after_friend")
    return await findWelcomeCandidates(admin, args);
  if (args.presetKey === "line_dormant_outreach") return await findDormantCandidates(admin, args);
  if (args.presetKey === "line_register_meeting_promotion")
    return await findRegisterMeetingPromotionLine(admin, args);
  if (args.presetKey === "line_meeting_reminder") return await findMeetingReminderLine(admin, args);
  if (args.presetKey === "line_job_introduction") return await findJobIntroductionLine(admin, args);
  if (args.presetKey === "line_after_interview_followup")
    return await findAfterInterviewFollowupLine(admin, args);
  if (args.presetKey === "line_birthday_greeting")
    return await findBirthdayGreetingLine(admin, args);
  return [];
}

// ============================================================
// 共通 ヘルパー (linked friends + 既送信 除外)
// ============================================================

/**
 * 自組織 で client_records に 紐付け 済 (= linked) の 友達 を 取得。
 * Map で client_record_id → { lineUserId, displayName } を 返す。
 */
async function loadLinkedFriendsByClientId(
  admin: AdminClient,
  organizationId: string,
  clientIds?: string[],
): Promise<Map<string, { lineUserId: string; displayName: string | null }>> {
  let query = admin
    .from("line_user_links")
    .select("line_user_id, client_record_id, display_name")
    .eq("organization_id", organizationId)
    .is("unfollowed_at", null)
    .not("client_record_id", "is", null);
  if (clientIds && clientIds.length > 0) {
    query = query.in("client_record_id", clientIds);
  }
  const { data } = await query;
  type Row = { line_user_id: string; client_record_id: string; display_name: string | null };
  const map = new Map<string, { lineUserId: string; displayName: string | null }>();
  for (const r of (data ?? []) as Row[]) {
    map.set(r.client_record_id, { lineUserId: r.line_user_id, displayName: r.display_name });
  }
  return map;
}

/**
 * 同 シナリオ で 既送信 (status='sent') の line_user_id 集合 を 返す。
 */
async function loadSentLineUserIds(admin: AdminClient, scenarioId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("ma_send_logs")
    .select("recipient_line_user_id")
    .eq("scenario_id", scenarioId)
    .eq("status", "sent")
    .not("recipient_line_user_id", "is", null);
  return new Set(
    ((data ?? []) as Array<{ recipient_line_user_id: string }>).map(
      (l) => l.recipient_line_user_id,
    ),
  );
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

// ============================================================
// line_register_meeting_promotion:
//   登録日 (line_user_links.created_at) から N 日経過、
//   かつ interviews が 0 件、 未送信
// ============================================================
async function findRegisterMeetingPromotionLine(
  admin: AdminClient,
  args: { scenarioId: string; organizationId: string; triggerDays: number },
): Promise<Candidate[]> {
  const threshold = new Date(Date.now() - args.triggerDays * 86400_000).toISOString();
  const { data: links } = await admin
    .from("line_user_links")
    .select("line_user_id, client_record_id, display_name, created_at")
    .eq("organization_id", args.organizationId)
    .is("unfollowed_at", null)
    .not("client_record_id", "is", null)
    .lte("created_at", threshold)
    .limit(500);
  type LinkRow = {
    line_user_id: string;
    client_record_id: string;
    display_name: string | null;
  };
  const allLinks = (links ?? []) as LinkRow[];
  if (allLinks.length === 0) return [];

  const clientIds = allLinks.map((l) => l.client_record_id);
  const [interviewsRes, sentSet] = await Promise.all([
    admin
      .from("interviews")
      .select("referrals!inner(client_record_id)")
      .eq("organization_id", args.organizationId),
    loadSentLineUserIds(admin, args.scenarioId),
  ]);
  type IVRow = {
    referrals: { client_record_id: string } | { client_record_id: string }[] | null;
  };
  const clientsWithInterview = new Set(
    ((interviewsRes.data ?? []) as IVRow[])
      .map((r) => {
        const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
        return ref?.client_record_id;
      })
      .filter((id): id is string => !!id && clientIds.includes(id)),
  );

  return allLinks
    .filter((l) => !clientsWithInterview.has(l.client_record_id) && !sentSet.has(l.line_user_id))
    .map((l) => ({
      lineUserId: l.line_user_id,
      clientRecordId: l.client_record_id,
      displayName: l.display_name,
    }));
}

// ============================================================
// line_meeting_reminder: interviews.scheduled_at が 今 + |days| 日 ± 12h
// ============================================================
async function findMeetingReminderLine(
  admin: AdminClient,
  args: { scenarioId: string; organizationId: string; triggerDays: number },
): Promise<Candidate[]> {
  const targetTime = Date.now() + args.triggerDays * 86400_000;
  const windowMs = 12 * 3600 * 1000;
  const lower = new Date(targetTime - windowMs).toISOString();
  const upper = new Date(targetTime + windowMs).toISOString();

  const { data } = await admin
    .from("interviews")
    .select("scheduled_at, result, referrals!inner(client_record_id)")
    .eq("organization_id", args.organizationId)
    .eq("result", "scheduled")
    .gte("scheduled_at", lower)
    .lte("scheduled_at", upper);
  type IVRow = {
    referrals: { client_record_id: string } | { client_record_id: string }[] | null;
  };
  const clientIds = Array.from(
    new Set(
      ((data ?? []) as IVRow[])
        .map((r) => {
          const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
          return ref?.client_record_id;
        })
        .filter((id): id is string => !!id),
    ),
  );
  if (clientIds.length === 0) return [];

  const [friendMap, sentSet] = await Promise.all([
    loadLinkedFriendsByClientId(admin, args.organizationId, clientIds),
    loadSentLineUserIds(admin, args.scenarioId),
  ]);

  const out: Candidate[] = [];
  for (const cid of clientIds) {
    const f = friendMap.get(cid);
    if (!f) continue;
    if (sentSet.has(f.lineUserId)) continue;
    out.push({ lineUserId: f.lineUserId, clientRecordId: cid, displayName: f.displayName });
  }
  return out;
}

// ============================================================
// line_job_introduction: 1次面談 done から N 日経過、 referrals 0 件
// ============================================================
async function findJobIntroductionLine(
  admin: AdminClient,
  args: { scenarioId: string; organizationId: string; triggerDays: number },
): Promise<Candidate[]> {
  const cutoff = new Date(Date.now() - args.triggerDays * 86400_000).toISOString();
  const { data: interviews } = await admin
    .from("interviews")
    .select("scheduled_at, referrals!inner(client_record_id)")
    .eq("organization_id", args.organizationId)
    .eq("kind", "first")
    .eq("result", "done")
    .lte("scheduled_at", cutoff);
  type IVRow = {
    referrals: { client_record_id: string } | { client_record_id: string }[] | null;
  };
  const candidatesClientIds = Array.from(
    new Set(
      ((interviews ?? []) as IVRow[])
        .map((r) => {
          const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
          return ref?.client_record_id;
        })
        .filter((id): id is string => !!id),
    ),
  );
  if (candidatesClientIds.length === 0) return [];

  // referrals 0 件 を 残す
  const { data: refs } = await admin
    .from("referrals")
    .select("client_record_id")
    .eq("organization_id", args.organizationId)
    .in("client_record_id", candidatesClientIds);
  const refSet = new Set(
    ((refs ?? []) as Array<{ client_record_id: string }>).map((r) => r.client_record_id),
  );
  const noRefIds = candidatesClientIds.filter((id) => !refSet.has(id));
  if (noRefIds.length === 0) return [];

  const [friendMap, sentSet] = await Promise.all([
    loadLinkedFriendsByClientId(admin, args.organizationId, noRefIds),
    loadSentLineUserIds(admin, args.scenarioId),
  ]);

  const out: Candidate[] = [];
  for (const cid of noRefIds) {
    const f = friendMap.get(cid);
    if (!f) continue;
    if (sentSet.has(f.lineUserId)) continue;
    out.push({ lineUserId: f.lineUserId, clientRecordId: cid, displayName: f.displayName });
  }
  return out;
}

// ============================================================
// line_after_interview_followup: 2 次 / 最終 / 企業 面接 done から N 日経過
// ============================================================
async function findAfterInterviewFollowupLine(
  admin: AdminClient,
  args: { scenarioId: string; organizationId: string; triggerDays: number },
): Promise<Candidate[]> {
  const cutoff = new Date(Date.now() - args.triggerDays * 86400_000).toISOString();
  const { data: interviews } = await admin
    .from("interviews")
    .select("scheduled_at, referrals!inner(client_record_id)")
    .eq("organization_id", args.organizationId)
    .in("kind", ["second", "final", "company"])
    .eq("result", "done")
    .lte("scheduled_at", cutoff);
  type IVRow = {
    referrals: { client_record_id: string } | { client_record_id: string }[] | null;
  };
  const clientIds = Array.from(
    new Set(
      ((interviews ?? []) as IVRow[])
        .map((r) => {
          const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
          return ref?.client_record_id;
        })
        .filter((id): id is string => !!id),
    ),
  );
  if (clientIds.length === 0) return [];

  const [friendMap, sentSet] = await Promise.all([
    loadLinkedFriendsByClientId(admin, args.organizationId, clientIds),
    loadSentLineUserIds(admin, args.scenarioId),
  ]);

  const out: Candidate[] = [];
  for (const cid of clientIds) {
    const f = friendMap.get(cid);
    if (!f) continue;
    if (sentSet.has(f.lineUserId)) continue;
    out.push({ lineUserId: f.lineUserId, clientRecordId: cid, displayName: f.displayName });
  }
  return out;
}

// ============================================================
// line_birthday_greeting: client_records.birth_date の MM-DD が 今日 と 一致
// ============================================================
async function findBirthdayGreetingLine(
  admin: AdminClient,
  args: { scenarioId: string; organizationId: string },
): Promise<Candidate[]> {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  const { data: clients } = await admin
    .from("client_records")
    .select("id, birth_date")
    .eq("organization_id", args.organizationId)
    .not("birth_date", "is", null);
  type CRow = { id: string; birth_date: string | null };
  const matchedIds = ((clients ?? []) as CRow[])
    .filter((c) => {
      if (!c.birth_date) return false;
      const d = new Date(c.birth_date);
      return d.getMonth() + 1 === month && d.getDate() === day;
    })
    .map((c) => c.id);
  if (matchedIds.length === 0) return [];

  // 過去 1 年 以内 に 同 シナリオ で 送信 済 の friend は 除外
  const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString();
  const { data: recentLogs } = await admin
    .from("ma_send_logs")
    .select("recipient_line_user_id")
    .eq("scenario_id", args.scenarioId)
    .eq("status", "sent")
    .gte("sent_at", oneYearAgo);
  const recentlySent = new Set(
    ((recentLogs ?? []) as Array<{ recipient_line_user_id: string | null }>)
      .map((l) => l.recipient_line_user_id)
      .filter((id): id is string => !!id),
  );

  const friendMap = await loadLinkedFriendsByClientId(admin, args.organizationId, matchedIds);
  const out: Candidate[] = [];
  for (const cid of matchedIds) {
    const f = friendMap.get(cid);
    if (!f) continue;
    if (recentlySent.has(f.lineUserId)) continue;
    out.push({ lineUserId: f.lineUserId, clientRecordId: cid, displayName: f.displayName });
  }
  return out;
}
