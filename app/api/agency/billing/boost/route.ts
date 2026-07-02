/**
 * POST /api/agency/billing/boost   → AI Boost を 有効 化 (Standard → Pro)
 * DELETE /api/agency/billing/boost → AI Boost を 無効 化 (Pro → Standard)
 *
 * admin 専用。 課金 免除 中 は 拒否。 subscription 未 契約 も 拒否。
 *
 * 実装:
 *   ・POST: addSubscriptionItem(AI Boost price) → tier を standard_pro に、
 *           ai_boost_enabled=true、 stripe_subscription_item_id_ai_boost 保存
 *   ・DELETE: removeSubscriptionItem(既存 item_id) → tier を standard に、
 *            ai_boost_enabled=false、 item_id を NULL に
 *   ・DB 反映 は 本 route と Webhook の 両方 で 行われ る が、
 *     apply_stripe_subscription_sync RPC の idempotency ゲート で 重複 更新 は 弾かれる
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getBillingExemption } from "@/lib/billing/exemption";
import {
  addSubscriptionItem,
  getOrgStripeConfig,
  removeSubscriptionItem,
} from "@/lib/integrations/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const config = getOrgStripeConfig();
  if (!config) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const exemption = await getBillingExemption(organization.id);
  if (exemption.isExempt) {
    return NextResponse.json({ error: "billing_exempt" }, { status: 409 });
  }

  const { data: plan } = await supabase
    .from("organization_plans")
    .select("stripe_subscription_id, stripe_subscription_item_id_ai_boost, cycle, ai_boost_enabled")
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!plan?.stripe_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }
  if (plan.ai_boost_enabled) {
    return NextResponse.json({ error: "already_enabled" }, { status: 409 });
  }

  const priceId =
    plan.cycle === "yearly" ? config.prices.aiBoostYearly : config.prices.aiBoostMonthly;

  try {
    const created = await addSubscriptionItem(config, {
      subscriptionId: plan.stripe_subscription_id,
      priceId,
      quantity: 1,
      prorationBehavior: "create_prorations",
      // 同 subscription × 同 price で 冪等
      idempotencyKey: `ai-boost-add:${plan.stripe_subscription_id}:${priceId}`,
    });

    // DB 反映 (Webhook でも 反映 され るが、 UI 即応 の ため 先 に 更新)
    const admin = createServiceClient();
    await admin
      .from("organization_plans")
      .update({
        stripe_subscription_item_id_ai_boost: created.id,
        ai_boost_enabled: true,
        tier: "standard_pro",
      })
      .eq("organization_id", organization.id);

    return NextResponse.json({ ok: true, itemId: created.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stripe_error", detail: msg }, { status: 502 });
  }
}

export async function DELETE() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const config = getOrgStripeConfig();
  if (!config) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const exemption = await getBillingExemption(organization.id);
  if (exemption.isExempt) {
    return NextResponse.json({ error: "billing_exempt" }, { status: 409 });
  }

  const { data: plan } = await supabase
    .from("organization_plans")
    .select("stripe_subscription_item_id_ai_boost, ai_boost_enabled")
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!plan?.stripe_subscription_item_id_ai_boost) {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }

  try {
    await removeSubscriptionItem(config, {
      subscriptionItemId: plan.stripe_subscription_item_id_ai_boost,
      prorationBehavior: "create_prorations",
    });

    // tier と ai_boost_enabled を 同時 更新 (CHECK 制約 で 整合 が 保た れる)
    const admin = createServiceClient();
    await admin
      .from("organization_plans")
      .update({
        stripe_subscription_item_id_ai_boost: null,
        ai_boost_enabled: false,
        tier: "standard",
      })
      .eq("organization_id", organization.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stripe_error", detail: msg }, { status: 502 });
  }
}
