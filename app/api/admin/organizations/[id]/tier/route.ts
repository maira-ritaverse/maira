import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { PLAN_TIERS, SOLO_TIERS } from "@/lib/billing/agency";
import { countOrganizationSeats } from "@/lib/billing/org-checkout";
import {
  getOrgStripeConfig,
  isSoloTierValue,
  type OrgTier,
  swapSubscriptionTier,
} from "@/lib/integrations/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/admin/organizations/[id]/tier
 *
 * 運営者(Myaira admin)が、組織のプラン tier を Team 系 ⇄ Solo 系 に切り替える。
 * organization_plans.tier を直接更新する運営者オーバーライド(Stripe 課金とは非同期。
 * 課金は別途 Stripe 側で調整する前提)。
 *
 * Auth: profiles.is_maira_admin = true のみ。
 */
// PLAN_TIERS は Team 系のみ。Solo 系(SOLO_TIERS)を合わせて全 tier を許可する。
const ALL_TIERS = [...PLAN_TIERS, ...SOLO_TIERS] as unknown as [string, ...string[]];
const bodySchema = z.object({
  tier: z.enum(ALL_TIERS),
});

// Stripe で単一の請求構成に落とし込める tier(専用 Price が存在する)。
// standard_rec / standard_premium は専用 Price が無いため Stripe 入れ替えの対象外。
const STRIPE_TIERS: readonly OrgTier[] = ["standard", "standard_pro", "solo", "solo_pro"];
function isStripeRepresentableTier(t: string): t is OrgTier {
  return (STRIPE_TIERS as readonly string[]).includes(t);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isMairaAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
  }
  const tier = parsed.data.tier;

  const admin = createServiceClient();

  // 現在のプラン状態を取得(Stripe 契約中か・現 tier との差分を判定)。
  const { data: existingPlan } = await admin
    .from("organization_plans")
    .select("status, tier, stripe_subscription_id")
    .eq("organization_id", id)
    .maybeSingle();

  const hasActiveStripeSub =
    !!existingPlan?.stripe_subscription_id &&
    ["active", "trialing", "past_due"].includes(existingPlan.status ?? "");
  // 現 tier と同じなら Stripe を触る必要はない(同一変更の再送による item churn を避ける)。
  const tierChanged = existingPlan?.tier !== tier;

  // Stripe 契約中で tier が実際に変わる場合は、Stripe のサブスクリプションにも反映して
  // 請求内容を入れ替える。これをしないと「DB / 画面は Solo なのに Stripe は Team のまま
  // 課金され続ける」不整合になる(本不具合の原因)。Stripe 入れ替えを先に行い、成功した
  // 場合のみ DB を更新する(失敗時は不整合を作らない)。
  let didSwap = false;
  if (hasActiveStripeSub && tierChanged && existingPlan?.stripe_subscription_id) {
    // standard_rec / standard_premium は専用 Price が無く Stripe で表現できない。DB だけ
    // 変えると次の Webhook で元 tier に巻き戻り、かつ誤課金も止まらないため、Stripe
    // 契約中はこれらへの変更をブロックする(先に Stripe 側を調整する運用)。
    if (!isStripeRepresentableTier(tier)) {
      return NextResponse.json(
        {
          error: "tier_not_stripe_billable",
          message:
            "この組織は Stripe 契約中のため、専用の料金設定が無いプラン(録音 / Premium)へは変更できません。先に Stripe 側の契約を調整してください。",
        },
        { status: 409 },
      );
    }

    const config = getOrgStripeConfig();
    if (!config) {
      return NextResponse.json(
        { error: "stripe_not_configured", message: "Stripe の設定がサーバ側に未登録です。" },
        { status: 503 },
      );
    }
    // Team 系へ切り替えるときは実席数(最低 3)。Solo 系は常に 1 席。
    let seatCount = 3;
    if (!isSoloTierValue(tier)) {
      try {
        seatCount = await countOrganizationSeats(admin, id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: "seat_count_failed", message: msg }, { status: 500 });
      }
    }
    try {
      await swapSubscriptionTier(config, {
        subscriptionId: existingPlan.stripe_subscription_id,
        tier,
        seatCount,
        // 運営者オーバーライドでは想定外の日割り請求を避けるため既定 none(次回請求から新料金)。
        prorationBehavior: "none",
        // 分単位の冪等キー。タイムアウト再送時の二重差し替えを防ぐ。
        idempotencyKey: `org-tier-swap:${id}:${tier}:${Math.floor(Date.now() / 60000)}`,
      });
      didSwap = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[admin/tier] stripe swap failed", { organizationId: id, tier, message: msg });
      return NextResponse.json(
        {
          error: "stripe_swap_failed",
          message:
            "Stripe サブスクリプションの入れ替えに失敗しました。プランは変更していません。Stripe 側の状態をご確認のうえ、時間を置いて再度お試しください。",
          detail: msg,
        },
        { status: 502 },
      );
    }
  }

  // organization_id は PK。プラン行が無い組織でも tier を設定できるよう upsert。
  // ai_boost_enabled は CHECK 制約 org_plans_ai_boost_matches_tier_check
  //   (tier='standard_pro' <=> ai_boost_enabled=true)に一致させる必要がある。
  // tier だけ更新すると standard_pro への切替等で CHECK 違反 → 500 になるため必ずセットで更新。
  const upsertPayload: {
    organization_id: string;
    tier: string;
    ai_boost_enabled: boolean;
    stripe_subscription_item_id_extra_seat?: null;
    stripe_subscription_item_id_ai_boost?: null;
  } = {
    organization_id: id,
    tier,
    ai_boost_enabled: tier === "standard_pro",
  };
  if (didSwap) {
    // swap で旧 extra_seat / ai_boost item は削除済み。DB に古い item ID を残すと後続の
    // seat-sync / boost トグルが「No such subscription_item」(404)で恒久停止するため
    // null クリアする。新 item ID は直後の Webhook(subscription.updated)が再設定する。
    upsertPayload.stripe_subscription_item_id_extra_seat = null;
    upsertPayload.stripe_subscription_item_id_ai_boost = null;
  }
  const { error } = await admin
    .from("organization_plans")
    .upsert(upsertPayload, { onConflict: "organization_id" });
  if (error) {
    console.error("[admin/tier] update failed", { organizationId: id, message: error.message });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  await recordAuditLog({
    userId: user.id,
    action: "subscription_changed",
    metadata: { organizationId: id, tier, via: "admin_tier_override" },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, tier });
}
