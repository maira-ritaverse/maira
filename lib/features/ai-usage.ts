/**
 * AI 利用量(月次クォータ)ヘルパ
 *
 * - フリー枠 vs アドオン枠で 既定上限を出し分け
 * - 組織が organization_ai_quotas で カスタム上限を 設定していれば そちらを優先
 * - kind の scope(組織側 / 求職者側)に応じて 集計対象を 切り替え
 *
 * 「呼び出してから記録」する 2 段階で運用:
 *   1) checkAiUsageLimit(...) で allowed 判定
 *   2) AI 呼出が成功したら recordAiUsage(...) で 1 行 INSERT
 *
 * 競合(同時実行で limit を超える)は許容範囲とみなす(±1 ズレ程度)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasAddon } from "./entitlements";
import { utcMonthStart, utcNextMonthStart } from "./usage-limits";

export type AiUsageKind =
  | "photo_enhance"
  | "job_recommendation_seeker"
  | "job_recommendation_agency"
  | "recommendation_letter_draft"
  | "agency_cv_draft"
  | "agency_resume_draft"
  | "job_extract_from_document"
  | "csv_column_mapping"
  // 求職者 ドキュメント 作成系 (月次リセット + ブーストチケット で +10 件 × 3 ヶ月)
  | "seeker_resume_create"
  | "seeker_cv_create"
  // 求職者 AI 下書き系 (月次リセット、 ブースト対象外 ハード上限)
  | "seeker_resume_ai_draft"
  | "seeker_cv_ai_draft";

/** kind の scope:組織側(全メンバー合算上限)/ 求職者側(1 人あたり上限) */
type KindScope = "agency_org" | "seeker_per_user";

const KIND_SCOPE: Record<AiUsageKind, KindScope> = {
  photo_enhance: "seeker_per_user",
  job_recommendation_seeker: "seeker_per_user",
  job_recommendation_agency: "agency_org",
  recommendation_letter_draft: "agency_org",
  agency_cv_draft: "agency_org",
  agency_resume_draft: "agency_org",
  job_extract_from_document: "agency_org",
  csv_column_mapping: "agency_org",
  seeker_resume_create: "seeker_per_user",
  seeker_cv_create: "seeker_per_user",
  seeker_resume_ai_draft: "seeker_per_user",
  seeker_cv_ai_draft: "seeker_per_user",
};

// 既定値(組織が 何も 設定していない 状態の フォールバック)
export const PHOTO_ENHANCE_FREE_MONTHLY = 5;
export const PHOTO_ENHANCE_ADDON_MONTHLY = 30;
export const JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY = 20;
export const JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY = 200;
// エージェント側は BtoB 利用前提で多めに設定(同じ Claude モデルのコスト)
export const JOB_RECOMMENDATION_AGENCY_FREE_MONTHLY = 50;
export const JOB_RECOMMENDATION_AGENCY_ADDON_MONTHLY = 500;
export const RECOMMENDATION_LETTER_DRAFT_FREE_MONTHLY = 100;
export const RECOMMENDATION_LETTER_DRAFT_ADDON_MONTHLY = 1000;
// 履歴書 / 職務経歴書 AI 下書き(エージェント側、組織横断 月次上限)
export const AGENCY_CV_DRAFT_FREE_MONTHLY = 100;
export const AGENCY_CV_DRAFT_ADDON_MONTHLY = 1000;
export const AGENCY_RESUME_DRAFT_FREE_MONTHLY = 100;
export const AGENCY_RESUME_DRAFT_ADDON_MONTHLY = 1000;
// PDF / 画像 から AI で 求人情報を 抽出(Vision 経由、1 回あたり ¥10-30 程度)
export const JOB_EXTRACT_FROM_DOCUMENT_FREE_MONTHLY = 30;
export const JOB_EXTRACT_FROM_DOCUMENT_ADDON_MONTHLY = 300;
// CSV 取り込み時の カラムマッピング 提案(軽量タスク、1 回あたり ¥1 未満)。
// CSV 1 つの 取り込みで 1 回 だけ 呼ばれる ので、ファイル数 上限 = 月次回数 上限。
export const CSV_COLUMN_MAPPING_FREE_MONTHLY = 100;
export const CSV_COLUMN_MAPPING_ADDON_MONTHLY = 1000;

// 求職者 ドキュメント 作成数 制限 (月次リセット)
// 5 件 を 超える 作成は seeker_doc_create_boosts チケット で +10 件 × 3 ヶ月。
export const SEEKER_RESUME_CREATE_FREE_MONTHLY = 5;
export const SEEKER_CV_CREATE_FREE_MONTHLY = 5;
export const SEEKER_DOC_CREATE_BOOST_DELTA = 10;

// 求職者 AI 下書き 上限 (月次リセット、 ブースト対象外 の ハード上限)
// 履歴書系 と 職務経歴書系 で それぞれ 別カウント。
export const SEEKER_RESUME_AI_DRAFT_HARD_MONTHLY = 20;
export const SEEKER_CV_AI_DRAFT_HARD_MONTHLY = 20;

/**
 * 企業 ごと の 月次 「総量」既定値。
 *
 * platform_ai_total_quotas に レコードが ない 場合 の フォールバック。
 * agency_org scope kinds の 合計 で この 値 を 超えたら 全 AI を 停止 する。
 * Maira admin が /admin/organizations/[id] で 上書き 可能。
 */
export const PLATFORM_AI_TOTAL_FREE_MONTHLY = 500;

export type AiUsageStatus = {
  allowed: boolean;
  current: number;
  limit: number;
  addon: boolean;
  kind: AiUsageKind;
  resetsAt: string;
  /** ユーザーが org member なのか seeker なのか(UI 表示で出し分け用) */
  callerScope: "agency_member" | "seeker" | "unknown";
};

function defaultLimitFor(kind: AiUsageKind, addon: boolean): number {
  switch (kind) {
    case "photo_enhance":
      return addon ? PHOTO_ENHANCE_ADDON_MONTHLY : PHOTO_ENHANCE_FREE_MONTHLY;
    case "job_recommendation_seeker":
      return addon
        ? JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY
        : JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY;
    case "job_recommendation_agency":
      return addon
        ? JOB_RECOMMENDATION_AGENCY_ADDON_MONTHLY
        : JOB_RECOMMENDATION_AGENCY_FREE_MONTHLY;
    case "recommendation_letter_draft":
      return addon
        ? RECOMMENDATION_LETTER_DRAFT_ADDON_MONTHLY
        : RECOMMENDATION_LETTER_DRAFT_FREE_MONTHLY;
    case "agency_cv_draft":
      return addon ? AGENCY_CV_DRAFT_ADDON_MONTHLY : AGENCY_CV_DRAFT_FREE_MONTHLY;
    case "agency_resume_draft":
      return addon ? AGENCY_RESUME_DRAFT_ADDON_MONTHLY : AGENCY_RESUME_DRAFT_FREE_MONTHLY;
    case "job_extract_from_document":
      return addon
        ? JOB_EXTRACT_FROM_DOCUMENT_ADDON_MONTHLY
        : JOB_EXTRACT_FROM_DOCUMENT_FREE_MONTHLY;
    case "csv_column_mapping":
      return addon ? CSV_COLUMN_MAPPING_ADDON_MONTHLY : CSV_COLUMN_MAPPING_FREE_MONTHLY;
    case "seeker_resume_create":
      return SEEKER_RESUME_CREATE_FREE_MONTHLY;
    case "seeker_cv_create":
      return SEEKER_CV_CREATE_FREE_MONTHLY;
    case "seeker_resume_ai_draft":
      return SEEKER_RESUME_AI_DRAFT_HARD_MONTHLY;
    case "seeker_cv_ai_draft":
      return SEEKER_CV_AI_DRAFT_HARD_MONTHLY;
  }
}

/**
 * 自分の AI 利用回数(個人の今月分)
 * 既存の seeker 用 + recordAiUsage の 直後集計に 使う。
 */
export async function countAiUsageThisMonth(
  supabase: SupabaseClient,
  userId: string,
  kind: AiUsageKind,
  now: Date = new Date(),
): Promise<number> {
  const startIso = utcMonthStart(now).toISOString();
  const { count, error } = await supabase
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", startIso);
  if (error) return Number.MAX_SAFE_INTEGER;
  return count ?? 0;
}

/**
 * 組織横断の AI 利用回数(全メンバー合算 / 今月分)
 * SECURITY DEFINER RPC 経由で 取得(呼び出し元が 自組織の メンバーであることが
 * 必須、RPC 内で 認可)。
 */
async function countOrgAiUsageThisMonth(
  supabase: SupabaseClient,
  kind: AiUsageKind,
  now: Date = new Date(),
): Promise<number> {
  const startIso = utcMonthStart(now).toISOString();
  const { data, error } = await supabase.rpc("count_org_ai_usage_this_month", {
    p_kind: kind,
    p_month_start: startIso,
  });
  if (error) return Number.MAX_SAFE_INTEGER;
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * 組織の カスタム上限を 1 件取得(レコードが無ければ null)。
 *
 * 優先順位:
 *   1) platform_ai_quotas (Maira 運営 が 強制設定 / 料金プラン強制)
 *   2) organization_ai_quotas (エージェント admin の 自主設定)
 *   3) null (呼び出し側で defaultLimitFor に フォールバック)
 *
 * platform 設定が ある場合は 「上書き優先」の 設計判断により エージェント側
 * 設定 を 完全に 無視 する。
 */
async function getOrgQuotaForKind(
  supabase: SupabaseClient,
  kind: AiUsageKind,
): Promise<number | null> {
  // 1) platform 強制設定 を 先に 確認(SECURITY DEFINER RPC 経由 で 呼出元
  //    メンバー の 組織 の レコード を 1 件返す)
  const { data: platformLimit } = await supabase.rpc("get_platform_ai_quota_for_caller", {
    p_kind: kind,
  });
  if (typeof platformLimit === "number" && Number.isFinite(platformLimit)) {
    return platformLimit;
  }

  // 2) エージェント admin による カスタム設定
  const { data, error } = await supabase
    .from("organization_ai_quotas")
    .select("monthly_limit")
    .eq("kind", kind)
    .maybeSingle();
  if (error || !data) return null;
  const v = (data as { monthly_limit: number | null }).monthly_limit;
  return typeof v === "number" ? v : null;
}

/**
 * 呼出元 組織 の 月次 「総量」上限 を 取得。
 *
 * platform_ai_total_quotas に 設定があれば それ、無ければ 既定値
 * PLATFORM_AI_TOTAL_FREE_MONTHLY (= 500)。
 *
 * 求職者 (organization_members レコードなし) は 関知しない (呼出側で
 * scope=agency_org に 限って 呼ぶ)。
 */
async function getOrgTotalQuota(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("get_platform_ai_total_quota_for_caller");
  if (error) return PLATFORM_AI_TOTAL_FREE_MONTHLY;
  const v = typeof data === "number" ? data : Number(data);
  return Number.isFinite(v) ? v : PLATFORM_AI_TOTAL_FREE_MONTHLY;
}

/**
 * 呼出元 組織 の 月次 「総量」利用回数 を 取得。
 *
 * agency_org scope kinds の 合算 (seeker_per_user kinds は 除外)。
 * 失敗時は MAX_SAFE_INTEGER で 安全側 (=必ず 拒否側に 寄る)。
 */
async function countOrgTotalAiUsageThisMonth(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const startIso = utcMonthStart(now).toISOString();
  const { data, error } = await supabase.rpc("count_org_ai_usage_total_this_month", {
    p_month_start: startIso,
  });
  if (error) return Number.MAX_SAFE_INTEGER;
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * 求職者の 紐づき先組織で 設定されている 上限の 最大値(複数組織なら寛大な方)。
 * SECURITY DEFINER RPC で 取得。
 */
async function getSeekerQuotaForKind(
  supabase: SupabaseClient,
  kind: AiUsageKind,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("get_seeker_quota_for_kind", {
    p_kind: kind,
  });
  if (error || data === null || data === undefined) return null;
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) ? n : null;
}

/**
 * 求職者の 当月 アクティブ ブーストチケット 件数 を 取得。
 *
 * ブースト 1 枚 = 履歴書 + 職務経歴書 両方 に +10 件 / 月、3 ヶ月有効、スタック可。
 * 例えば 1 月 と 3 月 に 1 枚 ずつ 購入 → 3 月 は アクティブ 2 枚 で +20 件。
 *
 * SECURITY DEFINER RPC 経由 で 呼出元 ユーザー の チケットだけを 数える。
 */
async function getSeekerDocCreateBoostCount(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const monthStart = utcMonthStart(now);
  const { data, error } = await supabase.rpc("get_seeker_doc_create_boost_count", {
    p_month_start: monthStart.toISOString(),
  });
  if (error) return 0;
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 呼び出し元の account_type / member ロールを ざっくり判定。
 * profiles.account_type を 直接見る(getUserRole のような重いクエリは 避ける)。
 */
async function detectCallerScope(
  supabase: SupabaseClient,
  userId: string,
): Promise<"agency_member" | "seeker"> {
  const { data } = await supabase
    .from("profiles")
    .select("account_type")
    .eq("id", userId)
    .maybeSingle();
  const at = (data as { account_type?: string } | null)?.account_type;
  if (at === "organization_member") {
    // 実体の確認:organization_members レコードが 無ければ seeker 扱い(安全側)
    const { count } = await supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) > 0) return "agency_member";
  }
  return "seeker";
}

export async function checkAiUsageLimit(
  supabase: SupabaseClient,
  userId: string,
  kind: AiUsageKind,
  now: Date = new Date(),
): Promise<AiUsageStatus> {
  const addon = await hasAddon(supabase, userId, "meeting_recording_auto", now);
  const scopeOfKind = KIND_SCOPE[kind];
  const callerScope = await detectCallerScope(supabase, userId);

  // scope 不一致の 場合は 即時拒否(403 相当)
  // ・seeker_per_user kind を agency_member が 叩く → 拒否
  // ・agency_org kind を seeker が 叩く → 拒否
  const scopeMatches =
    (scopeOfKind === "agency_org" && callerScope === "agency_member") ||
    (scopeOfKind === "seeker_per_user" && callerScope === "seeker");
  if (!scopeMatches) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      addon,
      kind,
      resetsAt: utcNextMonthStart(now).toISOString(),
      callerScope,
    };
  }

  // 上限値の決定:組織のカスタム設定があれば それを 採用、無ければ 既定値
  let limit: number;
  if (scopeOfKind === "agency_org") {
    const custom = await getOrgQuotaForKind(supabase, kind);
    limit = custom ?? defaultLimitFor(kind, addon);
  } else {
    const custom = await getSeekerQuotaForKind(supabase, kind);
    limit = custom ?? defaultLimitFor(kind, addon);
  }

  // 求職者 ドキュメント 作成系 (resume / cv_create) は ブーストチケット で
  // 当月 のみ +10 件 / 枚 加算 する (3 ヶ月有効、スタック可)。
  // AI 下書き系 (resume / cv_ai_draft) は ブースト対象外 (ハード上限)。
  if (kind === "seeker_resume_create" || kind === "seeker_cv_create") {
    const boostCount = await getSeekerDocCreateBoostCount(supabase, now);
    limit += boostCount * SEEKER_DOC_CREATE_BOOST_DELTA;
  }

  // 利用数の集計:組織横断 or 個人 で 切り替え
  const current =
    scopeOfKind === "agency_org"
      ? await countOrgAiUsageThisMonth(supabase, kind, now)
      : await countAiUsageThisMonth(supabase, userId, kind, now);

  // 総量チェック (agency_org のみ):企業全体の月次合計が 総量上限を 超えたら 拒否
  // platform_ai_total_quotas で 個別設定があれば それ、無ければ 既定 500
  if (scopeOfKind === "agency_org") {
    const total = await getOrgTotalQuota(supabase);
    const totalUsage = await countOrgTotalAiUsageThisMonth(supabase, now);
    if (totalUsage >= total) {
      // 総量超過時:limit を 0 と 報告して allowed=false
      // current は 「現在 の kind の 使用回数」を 維持 (UI 表示用)
      return {
        allowed: false,
        current,
        limit: 0,
        addon,
        kind,
        resetsAt: utcNextMonthStart(now).toISOString(),
        callerScope,
      };
    }
  }

  return {
    allowed: current < limit,
    current,
    limit,
    addon,
    kind,
    resetsAt: utcNextMonthStart(now).toISOString(),
    callerScope,
  };
}

/**
 * 利用ログを 1 行 INSERT する。
 * 失敗時はログのみ(本処理は止めない)。
 */
export async function recordAiUsage(
  supabase: SupabaseClient,
  userId: string,
  kind: AiUsageKind,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase
      .from("ai_usage_events")
      .insert({ user_id: userId, kind, metadata: metadata ?? null });
  } catch (err) {
    console.warn("[ai-usage] insert failed", err);
  }
}
