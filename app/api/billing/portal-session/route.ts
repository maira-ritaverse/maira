import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { createPortalSession, getStripeConfig } from "@/lib/integrations/stripe";

/**
 * POST /api/billing/portal-session
 *
 * Stripe Billing Portal の Session URL を返す。本人の解約 / 支払方法変更導線。
 * customer_id は subscription_addons から引く(Stripe Webhook で保存済み前提)。
 */
export async function POST() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const config = getStripeConfig();
  if (!config) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const { data: row } = await supabase
    .from("subscription_addons")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .eq("addon_key", "meeting_recording_auto")
    .maybeSingle();

  if (!row?.stripe_customer_id) {
    return NextResponse.json(
      {
        error: "no_customer",
        message: "Stripe 顧客情報が見つかりません。先にアドオンを購入してください。",
      },
      { status: 404 },
    );
  }

  try {
    const session = await createPortalSession(config, row.stripe_customer_id);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "portal_create_failed", message: msg }, { status: 502 });
  }
}
