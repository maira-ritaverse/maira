/**
 * POST /api/agency/billing/portal-session
 *
 * 組織 の Stripe Billing Portal (解約 / カード 変更 / 領収書) URL を 返す。
 * admin 専用。 個人 アドオン 用 /api/billing/portal-session と 別。
 *
 * Body: {} (customer_id は organization_plans か ら 引く)
 *
 * 検証:
 *   1. requireOrgAdmin — admin のみ
 *   2. Stripe 設定 (env) の 存在
 *   3. 課金 免除 なら 拒否
 *   4. organization_plans.stripe_customer_id が あれば Portal に 渡す
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getBillingExemption } from "@/lib/billing/exemption";
import { createOrgPortalSession, getOrgStripeConfig } from "@/lib/integrations/stripe";

export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const config = getOrgStripeConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "Stripe 組織 プラン の 設定 が サーバ 側 に あり ません。",
      },
      { status: 503 },
    );
  }

  const exemption = await getBillingExemption(organization.id);
  if (exemption.isExempt) {
    return NextResponse.json(
      {
        error: "billing_exempt",
        message: "課金 免除 対象 の 組織 の ため、 Billing Portal は ご 利用 いただけ ません。",
      },
      { status: 409 },
    );
  }

  const { data: plan } = await supabase
    .from("organization_plans")
    .select("stripe_customer_id")
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!plan?.stripe_customer_id) {
    return NextResponse.json(
      {
        error: "no_customer",
        message:
          "まだ Stripe 顧客 情報 が 作成 されて い ません。 先 に プラン 加入 (Checkout) を お済ませ ください。",
      },
      { status: 404 },
    );
  }

  try {
    const session = await createOrgPortalSession(config, {
      customerId: plan.stripe_customer_id,
      returnUrl: `${config.siteUrl}/agency/settings/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "stripe_portal_failed",
        message: "Billing Portal の 発行 に 失敗 しました。 時間 を 置いて 再 試行 して ください。",
        detail: msg,
      },
      { status: 502 },
    );
  }
}
