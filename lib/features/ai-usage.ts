/**
 * AI 利用量(月次クォータ)ヘルパ
 *
 * - フリー枠 vs アドオン枠で上限を出し分け
 * - AES 暗号化済データのデコードは不要(ログテーブルに機密は持たない)
 * - 失敗時は安全側に倒す(count を MAX_SAFE_INTEGER 扱い)
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
  | "recommendation_letter_draft";

export const PHOTO_ENHANCE_FREE_MONTHLY = 5;
export const PHOTO_ENHANCE_ADDON_MONTHLY = 30;
export const JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY = 20;
export const JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY = 200;
// エージェント側は BtoB 利用前提で多めに設定(同じ Claude モデルのコスト)
export const JOB_RECOMMENDATION_AGENCY_FREE_MONTHLY = 50;
export const JOB_RECOMMENDATION_AGENCY_ADDON_MONTHLY = 500;
// 推薦文ドラフト生成は BtoB 業務利用で 1 案件あたり 1〜数回程度。
// 無料枠は組織あたり月 100 件、アドオン契約で月 1000 件まで。
export const RECOMMENDATION_LETTER_DRAFT_FREE_MONTHLY = 100;
export const RECOMMENDATION_LETTER_DRAFT_ADDON_MONTHLY = 1000;

export type AiUsageStatus = {
  allowed: boolean;
  current: number;
  limit: number;
  addon: boolean;
  kind: AiUsageKind;
  resetsAt: string;
};

function limitsFor(kind: AiUsageKind, addon: boolean): number {
  if (kind === "photo_enhance") {
    return addon ? PHOTO_ENHANCE_ADDON_MONTHLY : PHOTO_ENHANCE_FREE_MONTHLY;
  }
  if (kind === "job_recommendation_agency") {
    return addon ? JOB_RECOMMENDATION_AGENCY_ADDON_MONTHLY : JOB_RECOMMENDATION_AGENCY_FREE_MONTHLY;
  }
  if (kind === "recommendation_letter_draft") {
    return addon
      ? RECOMMENDATION_LETTER_DRAFT_ADDON_MONTHLY
      : RECOMMENDATION_LETTER_DRAFT_FREE_MONTHLY;
  }
  // job_recommendation_seeker
  return addon ? JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY : JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY;
}

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

export async function checkAiUsageLimit(
  supabase: SupabaseClient,
  userId: string,
  kind: AiUsageKind,
  now: Date = new Date(),
): Promise<AiUsageStatus> {
  const addon = await hasAddon(supabase, userId, "meeting_recording_auto", now);
  const limit = limitsFor(kind, addon);
  const current = await countAiUsageThisMonth(supabase, userId, kind, now);
  return {
    allowed: current < limit,
    current,
    limit,
    addon,
    kind,
    resetsAt: utcNextMonthStart(now).toISOString(),
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
