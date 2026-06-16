/**
 * 機能利用回数の上限(基本プランの公平利用 / 課金導線)
 *
 * AI ヒアリング(録音アップロード)は基本プランに含むが、
 * Whisper / Claude のコストが線形に効くため月次の回数上限を設ける。
 *
 * - フリー(アドオン無し): INTAKE_FREE_MONTHLY_LIMIT 件 / 月
 * - 「meeting_recording_auto」アドオン契約者: INTAKE_ADDON_MONTHLY_LIMIT 件 / 月
 *
 * カレンダー月(JST 0:00)単位で集計するため、ローカル時間ではなく
 * UTC で当月 1 日 00:00 UTC を境界に使う(運用上ぶれが小さい近似)。
 * 厳密な JST 月初は将来 timezone 対応するときに直す。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasAddon } from "./entitlements";

export const INTAKE_FREE_MONTHLY_LIMIT = 3;
export const INTAKE_ADDON_MONTHLY_LIMIT = 50;

export type IntakeLimitStatus = {
  allowed: boolean;
  current: number;
  limit: number;
  addon: boolean;
  /** 次回リセット(UTC 翌月初日) */
  resetsAt: string;
};

/**
 * 現在の UTC 月初(YYYY-MM-01T00:00:00.000Z)を返す。
 */
export function utcMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * 翌月の UTC 月初。
 */
export function utcNextMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * 当月にユーザが作成した career_intake_recordings の件数を返す。
 *
 * 失敗(クライアントが状態を持たない場合)はカウント不能のため
 * 大きな値を返して安全側(=利用不可と判定される側)に倒す。
 */
export async function countIntakesInCurrentMonth(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const startIso = utcMonthStart(now).toISOString();
  const { count, error } = await supabase
    .from("career_intake_recordings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startIso);
  if (error) {
    return Number.MAX_SAFE_INTEGER;
  }
  return count ?? 0;
}

/**
 * 「今、新規アップロードして良いか」を判定し、利用状況サマリを返す。
 */
export async function checkIntakeLimit(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<IntakeLimitStatus> {
  const addon = await hasAddon(supabase, userId, "meeting_recording_auto", now);
  const limit = addon ? INTAKE_ADDON_MONTHLY_LIMIT : INTAKE_FREE_MONTHLY_LIMIT;
  const current = await countIntakesInCurrentMonth(supabase, userId, now);
  return {
    allowed: current < limit,
    current,
    limit,
    addon,
    resetsAt: utcNextMonthStart(now).toISOString(),
  };
}
