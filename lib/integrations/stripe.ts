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
    // subscription mode では customer_email から Stripe が Customer を
    // 自動生成する (customer_creation パラメータは payment/setup 専用で、
    // subscription に渡すと 400 で全 Checkout が失敗する)。
    body.set("customer_email", params.userEmail);
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

// =====================================================================
// 組織 月額 課金 (Standard / Standard Pro) 用 の 拡張
// -------------------------------------------------------------------
// 会議 録音 アドオン は 「個人 の 1 席」 に 課金 する 単一 line-item だ が、
// 組織 プラン は Base + Extra Seat (数量 可変) + AI Boost (オプション)
// の 最大 3 line-items で 構成 される。 更に 月次 / 年次、 30 日 トライアル、
// 席 数 変更 (数量 更新)、 AI Boost の 追加 / 削除、 期末 解約 / 再開 が 必要。
// これら は Checkout Session だけ で なく Subscription API を 直接 叩く
// 必要 が ある ため、 GET / DELETE も 使える 汎用 ヘルパ を 追加 する。
// =====================================================================

/**
 * 組織 課金 用 の env 設定。 従来 の StripeConfig とは 別 に、
 * 6 つ の Price ID (base × cycle 2、 extra_seat × cycle 2、 ai_boost × cycle 2)
 * と secretKey / siteUrl を まとめて 返す。
 *
 * なぜ 別 関数 に する か:
 *   - 会議 録音 アドオン だけ の 従来 導線 と env の 依存 セット が 違う
 *   - 一部 の 環境 (未 設定 の テスト 環境 等) で 組織 課金 だけ 使え なくて も
 *     アドオン は 動く、 と いう 段階 的 な ロール アウト を 許容 する ため
 */
export type OrgStripeConfig = {
  secretKey: string;
  siteUrl: string;
  prices: {
    standardBaseMonthly: string;
    standardBaseYearly: string;
    extraSeatMonthly: string;
    extraSeatYearly: string;
    aiBoostMonthly: string;
    aiBoostYearly: string;
  };
};

export function getOrgStripeConfig(): OrgStripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const standardBaseMonthly = process.env.STRIPE_PRICE_STANDARD_BASE_MONTHLY;
  const standardBaseYearly = process.env.STRIPE_PRICE_STANDARD_BASE_YEARLY;
  const extraSeatMonthly = process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY;
  const extraSeatYearly = process.env.STRIPE_PRICE_EXTRA_SEAT_YEARLY;
  const aiBoostMonthly = process.env.STRIPE_PRICE_AI_BOOST_MONTHLY;
  const aiBoostYearly = process.env.STRIPE_PRICE_AI_BOOST_YEARLY;

  if (
    !secretKey ||
    !siteUrl ||
    !standardBaseMonthly ||
    !standardBaseYearly ||
    !extraSeatMonthly ||
    !extraSeatYearly ||
    !aiBoostMonthly ||
    !aiBoostYearly
  ) {
    return null;
  }

  return {
    secretKey,
    siteUrl: siteUrl.replace(/\/$/, ""),
    prices: {
      standardBaseMonthly,
      standardBaseYearly,
      extraSeatMonthly,
      extraSeatYearly,
      aiBoostMonthly,
      aiBoostYearly,
    },
  };
}

// -------------------------------------------------------------------
// 共通 fetch ヘルパ (GET / DELETE を 追加)
// stripePost は 既存 の を そのまま 使う。 idempotency-key 対応 の ため
// stripePostWithHeaders を 追加 (Header 任意)。
// -------------------------------------------------------------------

async function stripeGet<T>(secretKey: string, path: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function stripeDelete<T>(secretKey: string, path: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe DELETE ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

/**
 * idempotency-key 対応 の POST ヘルパ。 既存 の stripePost は そのまま 残し、
 * Header を 渡し たい 場合 だけ こちら を 使う。
 *
 * なぜ idempotency-key が 必要 か:
 *   Checkout 作成 API を リトライ した とき に 二重 Session が 出来 ない よう
 *   Stripe の 冪等性 機能 で 同一 応答 を 返さ せる ため。
 */
async function stripePostWithHeaders<T>(
  secretKey: string,
  path: string,
  body: URLSearchParams,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

// -------------------------------------------------------------------
// 型 定義 (Stripe レスポンス の 使う 部分 だけ)
// -------------------------------------------------------------------

export type StripeCheckoutSession = {
  id: string;
  url: string;
  customer: string | null;
  subscription: string | null;
  metadata: Record<string, string> | null;
};

export type StripeSubscriptionItem = {
  id: string;
  price: {
    id: string;
    recurring: { interval: "month" | "year" } | null;
  };
  quantity: number;
};

export type StripeSubscription = {
  id: string;
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | "paused";
  customer: string;
  current_period_start: number;
  current_period_end: number;
  trial_start: number | null;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  items: {
    data: StripeSubscriptionItem[];
  };
  metadata: Record<string, string> | null;
};

export type OrgTier = "standard" | "standard_pro";
export type BillingCycle = "monthly" | "yearly";
export type ProrationBehavior = "create_prorations" | "none" | "always_invoice";

// -------------------------------------------------------------------
// 組織 プラン Checkout Session 作成
// -------------------------------------------------------------------

export type CreateOrgCheckoutParams = {
  organizationId: string;
  tier: OrgTier;
  cycle: BillingCycle;
  seatCount: number; // 管理 者 含む 総 席 数 (最低 3)
  adminEmail: string;
  existingCustomerId?: string | null;
  /**
   * 冪等 key。 呼び出し 側 で「organization_id + tier + cycle + 日時 bucket」
   * などで 生成 する。 省略 時 は 生成 しない。
   */
  idempotencyKey?: string;
};

/**
 * 組織 課金 の Checkout Session を 作る。
 *
 * 仕様:
 *   - 30 日 トライアル 付き (subscription_data.trial_period_days=30)
 *   - line_items[0]: Base (quantity=1)
 *   - line_items[1]: Extra Seat (quantity = max(seatCount - 3, 0))。 0 の 場合 は 積まない
 *   - line_items[2]: AI Boost (tier=standard_pro の とき のみ、 quantity=1)
 *   - metadata.organization_id を Session / Subscription 両方 に 埋める
 *   - metadata.scope=organization で アドオン 用 分岐 と 排他
 */
export function createOrgCheckoutSession(
  config: OrgStripeConfig,
  params: CreateOrgCheckoutParams,
): Promise<StripeCheckoutSession> {
  const body = new URLSearchParams();

  body.set("mode", "subscription");
  body.set("allow_promotion_codes", "true");
  body.set(
    "success_url",
    `${config.siteUrl}/agency/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  );
  body.set("cancel_url", `${config.siteUrl}/agency/settings/billing?checkout=canceled`);

  // line_items 組み立て
  const items = buildOrgLineItems(config, {
    tier: params.tier,
    cycle: params.cycle,
    seatCount: params.seatCount,
  });
  items.forEach((item, idx) => {
    body.set(`line_items[${idx}][price]`, item.price);
    body.set(`line_items[${idx}][quantity]`, String(item.quantity));
  });

  // 30 日 トライアル + subscription 側 metadata
  body.set("subscription_data[trial_period_days]", "30");
  body.set("subscription_data[metadata][organization_id]", params.organizationId);
  body.set("subscription_data[metadata][tier]", params.tier);
  body.set("subscription_data[metadata][cycle]", params.cycle);
  body.set("subscription_data[metadata][scope]", "organization");

  // Session 自体 の metadata
  body.set("metadata[organization_id]", params.organizationId);
  body.set("metadata[tier]", params.tier);
  body.set("metadata[cycle]", params.cycle);
  body.set("metadata[scope]", "organization");

  // customer
  if (params.existingCustomerId) {
    body.set("customer", params.existingCustomerId);
    body.set("customer_update[address]", "auto");
    body.set("customer_update[name]", "auto");
  } else {
    // subscription mode では customer_email から自動生成される
    // (customer_creation は subscription mode で使えない → 400)
    body.set("customer_email", params.adminEmail);
  }

  // トライアル ありでも カード 事前 登録 を 必須 に する
  body.set("payment_method_collection", "always");

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers["Idempotency-Key"] = params.idempotencyKey;
  }

  return stripePostWithHeaders<StripeCheckoutSession>(
    config.secretKey,
    "/checkout/sessions",
    body,
    headers,
  );
}

// -------------------------------------------------------------------
// 組織 Portal Session
// -------------------------------------------------------------------

export type CreateOrgPortalParams = {
  customerId: string;
  returnUrl: string;
};

export function createOrgPortalSession(
  config: OrgStripeConfig,
  params: CreateOrgPortalParams,
): Promise<PortalSession> {
  const body = new URLSearchParams({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
  return stripePostWithHeaders<PortalSession>(config.secretKey, "/billing_portal/sessions", body);
}

// -------------------------------------------------------------------
// 席 数 変更 (Extra Seat の quantity 更新)
// -------------------------------------------------------------------

export type UpdateSeatQuantityParams = {
  subscriptionItemId: string;
  quantity: number;
  prorationBehavior?: ProrationBehavior;
};

/**
 * Extra Seat の subscription item の quantity を 更新。
 *
 * prorationBehavior:
 *   - "create_prorations" (既定): 差額 を 次回 請求 に 反映
 *   - "always_invoice": 即時 請求
 *   - "none": 日割り なし
 */
export function updateSubscriptionSeatQuantity(
  config: OrgStripeConfig,
  params: UpdateSeatQuantityParams,
): Promise<StripeSubscriptionItem> {
  const body = new URLSearchParams({
    quantity: String(params.quantity),
    proration_behavior: params.prorationBehavior ?? "create_prorations",
  });
  return stripePostWithHeaders<StripeSubscriptionItem>(
    config.secretKey,
    `/subscription_items/${encodeURIComponent(params.subscriptionItemId)}`,
    body,
  );
}

// -------------------------------------------------------------------
// subscription item の 追加 / 削除 (AI Boost の トグル 等)
// -------------------------------------------------------------------

export type AddSubscriptionItemParams = {
  subscriptionId: string;
  priceId: string;
  quantity: number;
  prorationBehavior?: ProrationBehavior;
  /** 同じ subscription に 同じ price を 二重 で 追加 しない ため の 冪等 key */
  idempotencyKey?: string;
};

export function addSubscriptionItem(
  config: OrgStripeConfig,
  params: AddSubscriptionItemParams,
): Promise<StripeSubscriptionItem> {
  const body = new URLSearchParams({
    subscription: params.subscriptionId,
    price: params.priceId,
    quantity: String(params.quantity),
    proration_behavior: params.prorationBehavior ?? "create_prorations",
  });
  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers["Idempotency-Key"] = params.idempotencyKey;
  }
  return stripePostWithHeaders<StripeSubscriptionItem>(
    config.secretKey,
    "/subscription_items",
    body,
    headers,
  );
}

export type RemoveSubscriptionItemParams = {
  subscriptionItemId: string;
  prorationBehavior?: ProrationBehavior;
};

export function removeSubscriptionItem(
  config: OrgStripeConfig,
  params: RemoveSubscriptionItemParams,
): Promise<{ id: string; deleted: true }> {
  const qs = new URLSearchParams({
    proration_behavior: params.prorationBehavior ?? "create_prorations",
  });
  return stripeDelete<{ id: string; deleted: true }>(
    config.secretKey,
    `/subscription_items/${encodeURIComponent(params.subscriptionItemId)}?${qs.toString()}`,
  );
}

// -------------------------------------------------------------------
// 期末 解約
// -------------------------------------------------------------------

export type CancelSubscriptionParams = {
  subscriptionId: string;
  /** true (推奨): 期末 で 停止。 期間 中 は 引き続き 利用 可能。 */
  cancelAtPeriodEnd: boolean;
};

export function cancelSubscription(
  config: OrgStripeConfig,
  params: CancelSubscriptionParams,
): Promise<StripeSubscription> {
  if (params.cancelAtPeriodEnd) {
    const body = new URLSearchParams({ cancel_at_period_end: "true" });
    return stripePostWithHeaders<StripeSubscription>(
      config.secretKey,
      `/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
      body,
    );
  }
  return stripeDelete<StripeSubscription>(
    config.secretKey,
    `/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
  );
}

// -------------------------------------------------------------------
// 期末 解約 の 取り消し (再開)
// -------------------------------------------------------------------

export type ReactivateSubscriptionParams = {
  subscriptionId: string;
};

export function reactivateSubscription(
  config: OrgStripeConfig,
  params: ReactivateSubscriptionParams,
): Promise<StripeSubscription> {
  const body = new URLSearchParams({ cancel_at_period_end: "false" });
  return stripePostWithHeaders<StripeSubscription>(
    config.secretKey,
    `/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
    body,
  );
}

// -------------------------------------------------------------------
// 補助: subscription 参照 (Webhook で 使う)
// -------------------------------------------------------------------

export function retrieveSubscription(
  config: OrgStripeConfig,
  subscriptionId: string,
): Promise<StripeSubscription> {
  return stripeGet<StripeSubscription>(
    config.secretKey,
    `/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`,
  );
}

// -------------------------------------------------------------------
// line_items 構築 ロジック (単体 テスト 可能 に 切り出す)
// -------------------------------------------------------------------

export type OrgLineItem = { price: string; quantity: number };

export type BuildOrgLineItemsParams = {
  tier: OrgTier;
  cycle: BillingCycle;
  seatCount: number;
};

/**
 * tier / cycle / seatCount から line_items 配列 を 作る。
 *
 * ルール:
 *   1. seatCount は 最低 3 (Base に 3 席 込み)
 *   2. Extra Seat は max(seatCount - 3, 0) 個 (0 の とき は 積ま ない)
 *   3. AI Boost は tier=standard_pro の とき のみ 1 個
 *   4. cycle が monthly / yearly で Price ID を 切り替え
 */
export function buildOrgLineItems(
  config: OrgStripeConfig,
  params: BuildOrgLineItemsParams,
): OrgLineItem[] {
  if (params.seatCount < 3) {
    throw new Error(`seatCount は 最低 3 で ある 必要 が あります (指定: ${params.seatCount})`);
  }
  const p = config.prices;
  const isYearly = params.cycle === "yearly";

  const items: OrgLineItem[] = [];

  // Base
  items.push({
    price: isYearly ? p.standardBaseYearly : p.standardBaseMonthly,
    quantity: 1,
  });

  // Extra Seat
  const extra = params.seatCount - 3;
  if (extra > 0) {
    items.push({
      price: isYearly ? p.extraSeatYearly : p.extraSeatMonthly,
      quantity: extra,
    });
  }

  // AI Boost (Pro のみ)
  if (params.tier === "standard_pro") {
    items.push({
      price: isYearly ? p.aiBoostYearly : p.aiBoostMonthly,
      quantity: 1,
    });
  }

  return items;
}
