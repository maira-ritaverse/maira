/**
 * Stripe API 薄いラッパ(SDK 不使用、bare fetch)
 *
 * インストール禁止ルールに従い stripe-node を入れず、必要最小の
 * REST 呼び出しだけを行う。
 *
 * 対応:
 *   - Checkout Session 作成(アドオン購入導線)
 *   - Billing Portal Session 作成(解約 / カード変更)
 *
 * 認証は Authorization: Bearer {STRIPE_SECRET_KEY}。
 */

export type StripeConfig = {
  secretKey: string;
  addonPriceId: string;
  siteUrl: string;
};

export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const addonPriceId = process.env.STRIPE_PRICE_MEETING_RECORDING_AUTO;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!secretKey || !addonPriceId || !siteUrl) return null;
  return { secretKey, addonPriceId, siteUrl: siteUrl.replace(/\/$/, "") };
}

async function stripePost<T>(secretKey: string, path: string, body: URLSearchParams): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export type CheckoutSession = {
  id: string;
  url: string;
  customer: string | null;
};

/**
 * アドオン購入用の Checkout Session を作る。
 *
 * - mode=subscription:月額継続課金
 * - metadata.user_id:Webhook 側で subscription_addons.user_id にマップ
 * - customer_email:既存 customer を流用しないシンプル運用
 *   (重複作成のリスクはあるが、初期実装では許容)
 * - allow_promotion_codes:クーポン使えるように
 */
export function createCheckoutSession(
  config: StripeConfig,
  params: {
    userId: string;
    userEmail: string;
    existingCustomerId?: string | null;
  },
): Promise<CheckoutSession> {
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": config.addonPriceId,
    "line_items[0][quantity]": "1",
    success_url: `${config.siteUrl}/agency/settings/integrations?addon=success`,
    cancel_url: `${config.siteUrl}/agency/settings/integrations?addon=canceled`,
    "metadata[user_id]": params.userId,
    "subscription_data[metadata][user_id]": params.userId,
    allow_promotion_codes: "true",
  });
  if (params.existingCustomerId) {
    body.set("customer", params.existingCustomerId);
  } else {
    body.set("customer_email", params.userEmail);
    // 課金後に customer を残せるよう。default で残るが明示しておく。
    body.set("customer_creation", "always");
  }
  return stripePost<CheckoutSession>(config.secretKey, "/checkout/sessions", body);
}

export type PortalSession = {
  id: string;
  url: string;
};

/**
 * Billing Portal Session(解約 / 支払方法変更 UI)を作る。
 * customer_id が必須なので、subscription_addons.stripe_customer_id を参照する。
 */
export function createPortalSession(
  config: StripeConfig,
  customerId: string,
): Promise<PortalSession> {
  const body = new URLSearchParams({
    customer: customerId,
    return_url: `${config.siteUrl}/agency/settings/integrations`,
  });
  return stripePost<PortalSession>(config.secretKey, "/billing_portal/sessions", body);
}
