/**
 * POST /api/agency/billing/cancel
 *
 * 組織 の subscription を 期末 で 解約 予約 する (即時 停止 では ない)。
 * 期末 まで は 引き続き 利用 可能。 Stripe 側 の cancel_at_period_end=true。
 *
 * admin 専用。 課金 免除 中 は 拒否。 subscription 未 契約 も 拒否。
 * DB 側 の canceled_at は Webhook (customer.subscription.updated) で 反映 される。
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getBillingExemption } from "@/lib/billing/exemption";
import { cancelSubscription, getOrgStripeConfig } from "@/lib/integrations/stripe";

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
    .select("stripe_subscription_id, status, canceled_at")
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!plan?.stripe_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }
  if (plan.canceled_at) {
    return NextResponse.json({ error: "already_canceled" }, { status: 409 });
  }

  try {
    const sub = await cancelSubscription(config, {
      subscriptionId: plan.stripe_subscription_id,
      cancelAtPeriodEnd: true,
    });
    return NextResponse.json({
      ok: true,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: sub.current_period_end,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stripe_error", detail: msg }, { status: 502 });
  }
}
