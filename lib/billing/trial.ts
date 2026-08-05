/**
 * トライアル(無料期間)の状態取得 + 運営による延長。
 *
 * organization_plans は RLS で INSERT/UPDATE が service_role 限定のため、
 * 更新は createServiceClient() 経由で行う(billing/exemption.ts と同方針)。
 * 列追加は不要:既存の trial_ends_at / current_period_end / status を使う。
 *
 * トライアル失効は cron(app/api/internal/billing/trial-expire)が
 * trial_ends_at < now を検知して行うので、trial_ends_at を未来へ延ばせば失効が止まる。
 */
import { recordAuditLog } from "@/lib/audit/audit-log";
import { createServiceClient } from "@/lib/supabase/service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一度に延長できる上限日数(誤操作で何年も延ばさないための安全弁)。 */
export const TRIAL_EXTEND_MAX_DAYS = 365;

export type TrialState = {
  /** organization_plans 行があるか。無い組織はトライアル対象外(未契約)。 */
  hasPlan: boolean;
  tier: string | null;
  status: string | null;
  /** トライアル終了日時(ISO)。 */
  trialEndsAt: string | null;
  /** status === 'trialing' か。 */
  isTrialing: boolean;
  /**
   * Stripe 契約(stripe_subscription_id)を持つか。true の組織は状態を Stripe Webhook が
   * 管理するため、トライアル延長の対象外(延長すると課金と不整合になる)。
   * 未決済の純粋なトライアル組織は stripe_subscription_id が NULL(= false)。
   */
  hasStripeSubscription: boolean;
};

type PlanRow = {
  tier: string | null;
  status: string | null;
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
};

/** 指定組織のトライアル状態を取得(service_role)。 */
export async function getOrganizationTrialState(organizationId: string): Promise<TrialState> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("organization_plans")
    .select("tier, status, trial_ends_at, stripe_subscription_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const row = data as PlanRow | null;
  return {
    hasPlan: row != null,
    tier: row?.tier ?? null,
    status: row?.status ?? null,
    trialEndsAt: row?.trial_ends_at ?? null,
    isTrialing: row?.status === "trialing",
    hasStripeSubscription: row?.stripe_subscription_id != null,
  };
}

export type ExtendTrialResult =
  | { ok: true; newTrialEndsAt: string; previousTrialEndsAt: string | null }
  | {
      ok: false;
      error: "no_plan" | "invalid_days" | "stripe_managed" | "save_failed";
      message: string;
    };

/**
 * トライアルを N 日延長する(運営専用。呼び出し側で admin 認証済みのこと)。
 *
 * - 起点 = 現 trial_ends_at が未来ならそこ、過ぎていれば本日。そこに +days 日。
 * - trial_ends_at と current_period_end を新期限に、status を 'trialing' に更新。
 *   失効していた組織もトライアル再開になる。tier は変更しない。
 * - 有料契約中(status === 'active')の組織は課金を壊さないため拒否する。
 */
export async function extendOrganizationTrial(args: {
  organizationId: string;
  days: number;
  actingUserId: string;
}): Promise<ExtendTrialResult> {
  const { organizationId, days, actingUserId } = args;

  if (!Number.isInteger(days) || days < 1 || days > TRIAL_EXTEND_MAX_DAYS) {
    return {
      ok: false,
      error: "invalid_days",
      message: `延長日数は 1〜${TRIAL_EXTEND_MAX_DAYS} の整数で指定してください。`,
    };
  }

  const admin = createServiceClient();
  const { data: planRow, error: readErr } = await admin
    .from("organization_plans")
    .select("tier, status, trial_ends_at, stripe_subscription_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (readErr) {
    return { ok: false, error: "save_failed", message: readErr.message };
  }
  const plan = planRow as PlanRow | null;
  if (!plan) {
    // プラン未作成の組織はトライアル延長の対象外(発行フローで作られる前提)。
    return { ok: false, error: "no_plan", message: "この組織にはプラン情報がありません(未契約)。" };
  }
  if (plan.stripe_subscription_id != null) {
    // Stripe 契約済みの組織は状態を Webhook が管理する(trialing→active、active→past_due
    // →canceled 等)。ここで trial_ends_at / status を書き換えると課金と不整合になるため
    // 対象外にする。純粋な未決済トライアル(stripe_subscription_id が NULL)のみ延長する。
    return {
      ok: false,
      error: "stripe_managed",
      message:
        "この組織は Stripe 契約があるため、トライアル延長の対象外です(契約状態は Stripe 側で管理されます)。",
    };
  }

  const now = Date.now();
  const currentEndMs = plan.trial_ends_at ? new Date(plan.trial_ends_at).getTime() : NaN;
  // 起点:現終了日が未来ならそこから、過ぎている/未設定なら本日から。
  const baseMs = Number.isFinite(currentEndMs) && currentEndMs > now ? currentEndMs : now;
  const newEnd = new Date(baseMs + days * DAY_MS).toISOString();

  const { error: updErr } = await admin
    .from("organization_plans")
    .update({
      status: "trialing",
      trial_ends_at: newEnd,
      current_period_end: newEnd,
      // 失効(canceled)トライアルを再開する場合、canceled_at が残ると
      // 「trialing なのに解約時刻あり」の不整合行になるためクリアする。
      canceled_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);
  if (updErr) {
    return { ok: false, error: "save_failed", message: updErr.message };
  }

  // 監査ログ(失敗しても延長自体は成立させる)。
  await recordAuditLog({
    userId: actingUserId,
    action: "subscription_changed",
    metadata: {
      event_subtype: "admin_extended_trial",
      organization_id: organizationId,
      days,
      previous_trial_ends_at: plan.trial_ends_at,
      new_trial_ends_at: newEnd,
    },
  });

  return { ok: true, newTrialEndsAt: newEnd, previousTrialEndsAt: plan.trial_ends_at };
}
