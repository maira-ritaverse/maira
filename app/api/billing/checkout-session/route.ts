import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { createCheckoutSession, getStripeConfig } from "@/lib/integrations/stripe";

/**
 * POST /api/billing/checkout-session
 *
 * 「会議録音 自動連携」アドオン購入用の Stripe Checkout Session を作って URL を返す。
 * 既存の subscription_addons.stripe_customer_id があれば再利用、無ければメール経由で新規。
 */
export async function POST() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const config = getStripeConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "Stripe 設定がサーバ側に登録されていません。",
      },
      { status: 503 },
    );
  }

  if (!user.email) {
    return NextResponse.json({ error: "no_email" }, { status: 400 });
  }

  // 既存 customer_id があれば再利用(Checkout の重複 customer 作成を防ぐ)
  const { data: existing } = await supabase
    .from("subscription_addons")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .eq("addon_key", "meeting_recording_auto")
    .maybeSingle();

  try {
    const session = await createCheckoutSession(config, {
      userId: user.id,
      userEmail: user.email,
      existingCustomerId: existing?.stripe_customer_id ?? null,
    });
    return NextResponse.json({ url: session.url, id: session.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "checkout_create_failed", message: msg }, { status: 502 });
  }
}
