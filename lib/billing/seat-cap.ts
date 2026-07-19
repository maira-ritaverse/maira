/**
 * 席数 上限 (organization_members) の 判定 helper。
 *
 * Solo プラン (1 席 固定) を 追加 する に あたり、 「メンバー 招待 時 に この
 * プラン で は もう 席 が 埋まって いる か」 を 判定 する 集約 API を 提供 する。
 *
 * 使用 例:
 *   ・POST /api/agency/invitations (招待 発行 API): 上限 到達 な ら 402 で 拒否
 *   ・issue_invitation RPC (defence-in-depth): 上限 到達 な ら raise exception
 *   ・UI: 「メンバー 招待」 ボタン の 有効 / 無効 判定
 *
 * 実装 方針:
 *   ・「上限 到達 か」 は 現役 メンバー (removed_at is null) + 保留中 招待
 *     (accepted_at is null and revoked_at is null) の 合算 で 判定
 *   ・「保留中 招待 を 席数 に 含める」 の は、 招待 発行 済 だが まだ 受諾 前 の
 *     枠 も 「予約 済」 として 扱う ため。 逆 (受諾時 の み カウント) だと 招待
 *     を 大量発行 して 席数 超過 で 一気 に 受諾 させる 抜け穴 が できる。
 *
 * Phase 1 で は 判定 API のみ を 提供 し、 実際 の ガード (招待 発行 側 の
 * 「上限 到達 なら 拒否」) は 別 コミット (Phase 5) で 実装。 それ まで は
 * 呼び出し 側 が 使わ ない ので 挙動 は 変わら ない。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPlanEntitlements } from "./plan-entitlements";
import type { PlanTierValue } from "./tier-limits";

export type SeatCapStatus = {
  /** 上限 に 達して いる か */
  reached: boolean;
  /** 現時点 の 使用 席数 (現役 メンバー + 保留中 招待) */
  current: number;
  /** 席数 上限 (プラン tier から 決定) */
  cap: number;
  /** どの tier で 判定 したか */
  tier: PlanTierValue;
};

/**
 * 組織 の 現在 の 席数 使用 状況 と 上限 を 取得。
 *
 * @param supabase user client (RLS 経由 で 自組織 に 限定 される 想定)
 * @param organizationId 対象 組織 ID
 * @param tier プラン tier (organization_plans.tier)
 */
export async function getSeatCapStatus(
  supabase: SupabaseClient,
  organizationId: string,
  tier: PlanTierValue,
): Promise<SeatCapStatus> {
  const entitlements = getPlanEntitlements(tier);
  const cap = entitlements.seatCap;

  // 現役 メンバー数 (removed_at is null)
  const { count: memberCount } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("removed_at", null);

  // 保留中 招待 数 (accepted / revoked 前)
  const { count: pendingInviteCount } = await supabase
    .from("organization_invitations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const current = (memberCount ?? 0) + (pendingInviteCount ?? 0);
  return {
    reached: current >= cap,
    current,
    cap,
    tier,
  };
}

/**
 * 「1 席 増やせる か」 の 判定 (招待発行 の 手前 で 呼ぶ)。
 *
 * true = 招待 発行 可、 false = 拒否 する べき。
 */
export async function canAddSeat(
  supabase: SupabaseClient,
  organizationId: string,
  tier: PlanTierValue,
): Promise<boolean> {
  const status = await getSeatCapStatus(supabase, organizationId, tier);
  return !status.reached;
}
