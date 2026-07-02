/**
 * 組織 Checkout 系 の 共通 バリデーション + 状態 判定 ヘルパ。
 *
 * API ルート (/api/agency/billing/checkout-session など) から 共通 で 使う:
 *   ・Zod スキーマ (body 検証)
 *   ・現在 の subscription 状態 が Checkout を 許可 する か 判定
 *   ・組織 の 席 数 集計 (Base 3 席 + Extra Seat)
 */
import { z } from "zod";

import { SEAT_BASE_INCLUDED, countActiveMembers } from "@/lib/billing/seat-sync";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * POST /api/agency/billing/checkout-session の body。
 *
 * tier は 販売 中 の 2 種類 (standard / standard_pro) のみ 受理。
 * standard_rec / standard_premium は 現時点 未 販売 の ため、 UI からも
 * 選択 不可 だが 念のため サーバー でも 拒否 する。
 */
export const checkoutBodySchema = z.object({
  tier: z.enum(["standard", "standard_pro"]),
  cycle: z.enum(["monthly", "yearly"]),
});

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

/**
 * 現在 の subscription 状態 で Checkout を 拒否 する べき か 判定。
 *
 * 拒否 する ケース:
 *   ・trialing / active — 既 に 契約 中 (二重 契約 防止)
 *   ・past_due — 支払 失敗 中、 まず Portal で 支払 方法 を 直す
 *   ・incomplete — 初期 SCA 未 完了、 前 の Checkout URL を 使う 必要
 *
 * 許可 する ケース:
 *   ・null (プラン 未 開始) — 通常 の 新規 契約
 *   ・canceled — 過去 に 解約 した 組織 の 再契約
 */
export function isCheckoutBlockedByStatus(
  status: string | null | undefined,
):
  | { blocked: true; reason: "already_subscribed" | "past_due" | "incomplete" }
  | { blocked: false } {
  if (!status) return { blocked: false };
  if (status === "trialing" || status === "active") {
    return { blocked: true, reason: "already_subscribed" };
  }
  if (status === "past_due") {
    return { blocked: true, reason: "past_due" };
  }
  if (status === "incomplete") {
    return { blocked: true, reason: "incomplete" };
  }
  // canceled / incomplete_expired は 再契約 許可
  return { blocked: false };
}

/**
 * Checkout 時 の 席 数 を DB から 集計 する。
 * SEAT_BASE_INCLUDED (=3) を 下回る 場合 は 3 に 底 上げ (Base の 最低 席 数)。
 */
export async function countOrganizationSeats(
  admin: SupabaseClient,
  organizationId: string,
): Promise<number> {
  const memberCount = await countActiveMembers(admin, organizationId);
  return Math.max(SEAT_BASE_INCLUDED, memberCount);
}
