/**
 * POST /api/agency/billing/reactivate
 *
 * 期末 解約 予約 (cancel_at_period_end=true) を 取り 下げ、 契約 を 継続 させる。
 * すでに 期末 が 過ぎて canceled 状態 に なった 場合 は 新規 Checkout が 必要。
 *
 * admin 専用。 課金 免除 中 は 拒否。
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getBillingExemption } from "@/lib/billing/exemption";
import { getOrgStripeConfig, reactivateSubscription } from "@/lib/integrations/stripe";

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
  if (plan.status === "canceled") {
    return NextResponse.json(
      {
        error: "already_expired",
        message:
          "期末 が 過ぎて 完全 に 失効 して います。 再開 に は 新規 に Checkout し 直して ください。",
      },
      { status: 409 },
    );
  }
  if (!plan.canceled_at) {
    return NextResponse.json({ error: "not_canceled" }, { status: 409 });
  }

  try {
    const sub = await reactivateSubscription(config, {
      subscriptionId: plan.stripe_subscription_id,
    });
    return NextResponse.json({
      ok: true,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stripe_error", detail: msg }, { status: 502 });
  }
}
