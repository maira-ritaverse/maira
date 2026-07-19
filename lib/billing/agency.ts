/**
 * エージェント企業 課金プラン ヘルパー
 *
 * 仕様: docs/agency-billing-design.md
 *
 * 提供:
 *   - プラン Tier の 定数 / 型 / 表示名
 *   - Pro / Premium による AI 上限 ボーナス 計算 (+500)
 *   - 録音 機能 解放 判定 (録音 オプション / Premium)
 *   - トライアル 残日数 計算
 *   - 月額 料金 計算 (基本 + 4 人目以降 + アップグレード)
 *
 * Stripe 連携 後 も この モジュールが 唯一の「料金判定 source of truth」となる。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

// ============================================================
// 型 / 定数
// ============================================================

export type PlanTier = Database["public"]["Enums"]["organization_plan_tier"];
export type BillingCycle = Database["public"]["Enums"]["organization_billing_cycle"];
export type PlanStatus = Database["public"]["Enums"]["organization_plan_status"];

/**
 * Team 系 プラン tier (¥25,000 base + 席数 課金 + アップグレード)。
 * 従来 の 全 プラン。 UI で 「Team プラン 選択」 の 選択肢 として 使う。
 */
export const PLAN_TIERS = [
  "standard",
  "standard_rec",
  "standard_pro",
  "standard_premium",
] as const satisfies readonly PlanTier[];

/**
 * Solo 系 プラン tier (1 席 固定、 セルフサーブ、 base 課金 なし)。
 * Team 系 とは 料金 モデル が 全く 違う ため 別 配列。 computePrice など の
 * 「Team 系 料金 計算」 系 関数 は Solo tier を 受け取ら ない。
 */
export const SOLO_TIERS = ["solo", "solo_pro"] as const satisfies readonly PlanTier[];

export const PLAN_TIER_LABEL: Record<PlanTier, string> = {
  standard: "Standard",
  standard_rec: "Standard + 録音",
  standard_pro: "Standard + Pro",
  standard_premium: "Standard + Premium",
  solo: "Solo",
  solo_pro: "Solo Pro",
};

// ============================================================
// 料金 定数 (docs/agency-billing-design.md と 整合)
// ============================================================

export const PRICING = {
  /** 基本料金 (1〜3 人含む) */
  baseMonthly: 25_000,
  /** 4 人目以降 1 人 あたり (月額) */
  perSeatMonthly: 3_980,
  /** 基本料金 に 含まれる エージェント数 */
  includedSeats: 3,
  /** 録音 オプション (+) */
  recordingOptionMonthly: 10_000,
  /** Pro アップグレード (+) */
  proUpgradeMonthly: 4_200,
  /** Premium アップグレード (+) */
  premiumUpgradeMonthly: 12_000,
  /** 年払い 割引率 (10% OFF) */
  yearlyDiscountRate: 0.1,
} as const;

/**
 * 各 tier ごとの 「アップグレード 部分」月額 (基本 ¥25,000 と 別)。
 * Solo 系 は 料金 モデル が 別 な ので 0 (センチネル)。 computePrice に Solo tier
 * を 渡す と 例外 を 投げる 実装 に なって いる ので、 この 値 が 実際 に 参照
 * される 経路 は Team 系 に 限定 される。
 */
export const TIER_UPGRADE_MONTHLY: Record<PlanTier, number> = {
  standard: 0,
  standard_rec: PRICING.recordingOptionMonthly,
  standard_pro: PRICING.proUpgradeMonthly,
  standard_premium: PRICING.premiumUpgradeMonthly,
  solo: 0,
  solo_pro: 0,
};

/**
 * Solo 系 プラン の 月額 (税別)。 Team 系 と 違い 席数 課金 なし、 base 課金 なし。
 * Phase 1 で は 参照 用 のみ、 UI / Stripe 連携 は Phase 2 で 実装。
 */
export const SOLO_MONTHLY_PRICE: Record<(typeof SOLO_TIERS)[number], number> = {
  solo: 5_980,
  solo_pro: 9_800,
};

// ============================================================
// プラン由来 の 機能解放
// ============================================================

/**
 * tier に 紐づく AI 月次 ボーナス 回数。
 * Pro / Premium は +500、 他は 0。
 *
 * 集計フロー (lib/features/ai-usage.ts):
 *   1. platform_ai_total_quotas (admin 強制設定) が あれば それを 採用
 *   2. なければ PLATFORM_AI_TOTAL_FREE_MONTHLY (500) + この ボーナス (0 or 500)
 */
export const PLAN_AI_BONUS = 500;

// tier-limits.ts に「実 上限」 の 単一 source of truth を 集約 する。
// 既存 API (getAiBonusForTier / getEffectiveAiBonus) は 「ボーナス値」 で
// 返す 互換 の ため、 内部 で 減算 して 数値 を 揃える。
import {
  AI_TOTAL_STANDARD_MONTHLY,
  getAiTotalLimitByTier,
  getAiTotalLimitForPlan,
  isSoloTier,
  type PlanStatusValue,
} from "./tier-limits";

export function getAiBonusForTier(tier: PlanTier): number {
  // Solo 系 は 「Standard 500 を base と した ボーナス」 の 概念 が 通じない
  // (Solo は 100、 Solo Pro は 200 で 独立)。 差引で -400 等 の 意味 の ない 値 が
  // 出て 呼出 側 の 計算 を 壊さ ない よう 0 を 返す。 Solo 系 の 実 上限 は
  // getAiTotalLimitByTier / getAiTotalLimitForPlan 経由 で 直接 取得 する こと。
  if (isSoloTier(tier)) return 0;
  return getAiTotalLimitByTier(tier) - AI_TOTAL_STANDARD_MONTHLY;
}

/**
 * tier に 録音 機能が 含まれているか。
 * 録音 オプション or Premium で 有効。
 */
export function hasRecordingAccessForTier(tier: PlanTier): boolean {
  return tier === "standard_rec" || tier === "standard_premium";
}

/**
 * 録音 機能の 月次 件数 上限 (含まれる プランは 50 件、 含まれない プランは 0)。
 */
export const RECORDING_QUOTA_MONTHLY = 50;
export const RECORDING_MAX_MINUTES_PER_FILE = 90;

export function getRecordingQuotaForTier(tier: PlanTier): number {
  return hasRecordingAccessForTier(tier) ? RECORDING_QUOTA_MONTHLY : 0;
}

// ============================================================
// プラン取得 / トライアル 状態判定
// ============================================================

export type OrganizationPlan = {
  organizationId: string;
  tier: PlanTier;
  cycle: BillingCycle;
  status: PlanStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialUpgradeChoice: PlanTier | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBilledAt: string | null;
  canceledAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 現ユーザーの 組織の プラン情報 を 取得 (RLS 経由)。
 * 未開始 (= 行 なし) なら null。
 */
export async function getCurrentOrganizationPlan(
  supabase: SupabaseClient,
): Promise<OrganizationPlan | null> {
  const { data, error } = await supabase.rpc("get_my_organization_plan");
  if (error || !data || data.length === 0) return null;

  // RPC は table 戻り なので 配列。 0 行 / 1 行 のみ。
  const row = data[0] as {
    organization_id: string;
    tier: PlanTier;
    cycle: BillingCycle;
    status: PlanStatus;
    trial_started_at: string | null;
    trial_ends_at: string | null;
    trial_upgrade_choice: PlanTier | null;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billed_at: string | null;
    canceled_at: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    created_at: string;
    updated_at: string;
  };

  return {
    organizationId: row.organization_id,
    tier: row.tier,
    cycle: row.cycle,
    status: row.status,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    trialUpgradeChoice: row.trial_upgrade_choice,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    nextBilledAt: row.next_billed_at,
    canceledAt: row.canceled_at,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * service_role キー で 任意 組織の プランを 直接 取得 (Stripe Webhook 等で 使用)。
 */
export async function getOrganizationPlanByOrgId(
  adminSupabase: SupabaseClient,
  organizationId: string,
): Promise<OrganizationPlan | null> {
  const { data, error } = await adminSupabase
    .from("organization_plans")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    organization_id: string;
    tier: PlanTier;
    cycle: BillingCycle;
    status: PlanStatus;
    trial_started_at: string | null;
    trial_ends_at: string | null;
    trial_upgrade_choice: PlanTier | null;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billed_at: string | null;
    canceled_at: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    created_at: string;
    updated_at: string;
  };
  return {
    organizationId: row.organization_id,
    tier: row.tier,
    cycle: row.cycle,
    status: row.status,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    trialUpgradeChoice: row.trial_upgrade_choice,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    nextBilledAt: row.next_billed_at,
    canceledAt: row.canceled_at,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 「現在 トライアル 中 か」を 判定。
 * status=trialing かつ trial_ends_at が 未来。
 */
export function isInTrial(plan: OrganizationPlan, now: Date = new Date()): boolean {
  if (plan.status !== "trialing") return false;
  if (!plan.trialEndsAt) return false;
  return new Date(plan.trialEndsAt).getTime() > now.getTime();
}

/**
 * トライアル 残日数 (切上)。 トライアル 中でない 場合は 0。
 */
export function trialDaysRemaining(plan: OrganizationPlan, now: Date = new Date()): number {
  if (!isInTrial(plan, now)) return 0;
  if (!plan.trialEndsAt) return 0;
  const diffMs = new Date(plan.trialEndsAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * トライアル中 は すべての 機能 を 試せる:
 *   - AI ボーナス +500
 *   - 録音 機能 50 件
 *
 * 通常運用 では tier に 従う。
 */
export function getEffectiveAiBonus(plan: OrganizationPlan, now: Date = new Date()): number {
  // tier-limits.ts に 委譲 して 「実 上限」 を 求め、 従来 の 「ボーナス」 API と
  // 互換 に する ため 減算 で 戻す。 免除 フラグ は 現状 OrganizationPlan 型 に
  // 生えて い ない ため false 固定 (Standard 相当 の 挙動)。 将来 の 拡張 は
  // tier-limits.ts の コメント 参照。
  const total = getAiTotalLimitForPlan(
    {
      tier: plan.tier,
      status: plan.status as PlanStatusValue,
      trialEndsAt: plan.trialEndsAt,
      isBillingExempt: false,
    },
    now,
  );
  return total - AI_TOTAL_STANDARD_MONTHLY;
}

export function getEffectiveRecordingAccess(
  plan: OrganizationPlan,
  now: Date = new Date(),
): boolean {
  if (isInTrial(plan, now)) return true;
  return hasRecordingAccessForTier(plan.tier);
}

// ============================================================
// 月額 料金 計算
// ============================================================

export type PriceBreakdown = {
  base: number;
  perSeatExtra: number;
  upgrade: number;
  /** 月払い 合計 (= base + perSeatExtra + upgrade) */
  monthlyTotal: number;
  /** 年払い 合計 (10% OFF 適用後)。 cycle が yearly の 場合 のみ 参考値 を 返す */
  yearlyTotal: number;
  yearlyMonthlyEquivalent: number;
};

/**
 * プラン と エージェント人数 から 月額 料金 を 計算 する 純関数。
 *
 * @param tier プラン
 * @param seatCount 組織の メンバー総数 (admin + advisor、 4 人目以降 課金)
 * @param cycle 月払い / 年払い
 */
export function computePrice(
  tier: PlanTier,
  seatCount: number,
  cycle: BillingCycle = "monthly",
): PriceBreakdown {
  // Solo 系 は 料金 モデル が 全く 違う (base 課金 なし、 席数 課金 なし)。
  // 誤って 呼ばれた 場合 に ¥25,000 の 請求 に なる 事故 を 防ぐ ため 明示 的 に
  // 例外 を 投げる。 Solo の 料金 は SOLO_MONTHLY_PRICE 経由 で 参照 する こと。
  if (tier === "solo" || tier === "solo_pro") {
    throw new Error(
      `computePrice does not support Solo tiers (received: ${tier}). Use SOLO_MONTHLY_PRICE[tier] for Solo pricing.`,
    );
  }

  const safeSeatCount = Math.max(0, Math.floor(seatCount));
  const extraSeats = Math.max(0, safeSeatCount - PRICING.includedSeats);

  const base = PRICING.baseMonthly;
  const perSeatExtra = extraSeats * PRICING.perSeatMonthly;
  const upgrade = TIER_UPGRADE_MONTHLY[tier];
  const monthlyTotal = base + perSeatExtra + upgrade;

  const yearlyTotalGross = monthlyTotal * 12;
  const yearlyTotal = Math.round(yearlyTotalGross * (1 - PRICING.yearlyDiscountRate));
  const yearlyMonthlyEquivalent = Math.round(yearlyTotal / 12);

  return {
    base,
    perSeatExtra,
    upgrade,
    monthlyTotal: cycle === "monthly" ? monthlyTotal : yearlyMonthlyEquivalent,
    yearlyTotal,
    yearlyMonthlyEquivalent,
  };
}
