/**
 * エンタイトルメント(機能利用権限)ヘルパ
 *
 * 「このユーザはこのアドオンを有効化しているか?」を判定する。
 * subscription_addons テーブルから読み、status='active' かつ
 * current_period_end が未来 OR null のものを active とみなす。
 *
 * - サーバサイド(API route / RSC)から呼び出す前提
 * - クライアントから判定したい場合は /api/me/entitlements 経由で取得する
 *
 * 将来アドオンが増えたら ADDON_KEYS を拡張するだけで OK。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const ADDON_KEYS = ["meeting_recording_auto"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

export type AddonRow = {
  addon_key: AddonKey;
  status: "active" | "past_due" | "canceled";
  current_period_end: string | null;
};

/**
 * 「期間が生きている active なアドオンか」を判定する純関数。
 * テストしやすいよう DB アクセスから切り出している。
 */
export function isAddonActive(
  row: Pick<AddonRow, "status" | "current_period_end">,
  now: Date = new Date(),
): boolean {
  if (row.status !== "active") return false;
  if (!row.current_period_end) return true; // 期限未設定は無期限とみなす(MVP)
  return new Date(row.current_period_end).getTime() > now.getTime();
}

/**
 * 1 ユーザの全アドオン契約を取得し、active なものだけ AddonKey の配列で返す。
 */
export async function getActiveAddons(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<AddonKey[]> {
  const { data, error } = await supabase
    .from("subscription_addons")
    .select("addon_key, status, current_period_end")
    .eq("user_id", userId);
  if (error) {
    // 取得失敗時は安全側に倒す(=未契約扱い)
    return [];
  }
  const rows = (data ?? []) as AddonRow[];
  return rows.filter((r) => isAddonActive(r, now)).map((r) => r.addon_key);
}

/**
 * 指定キーのアドオンが有効か。
 */
export async function hasAddon(
  supabase: SupabaseClient,
  userId: string,
  key: AddonKey,
  now: Date = new Date(),
): Promise<boolean> {
  const actives = await getActiveAddons(supabase, userId, now);
  return actives.includes(key);
}
