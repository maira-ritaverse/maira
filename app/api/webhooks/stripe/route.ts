import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe Webhook を 受け て 以下 の 2 系統 を 同期 する:
 *   1. 組織 プラン (organization_plans): Standard Base / Extra Seat / AI Boost
 *   2. 個人 アドオン (subscription_addons): 会議 録音 自動 連携
 *
 * 系統 の 区別 は subscription.metadata.scope で 行う:
 *   ・scope = "organization" → organization_plans を 更新
 *   ・scope 無し / それ 以外  → 個人 アドオン 経路 (subscription_addons) に 委譲
 *
 * 検証:
 *   ・Stripe-Signature ヘッダ を STRIPE_WEBHOOK_SECRET で HMAC-SHA256 検証
 *   ・5 分 以内 の timestamp のみ 受理 (リプレイ 対策)
 *   ・stripe_events テーブル で event.id を PK に 二重 処理 防止
 */

const TOLERANCE_SEC = 300;

// ============================================
// 型 定義 (SDK 不使用 の た め 手 書き)
// ============================================

type StripeEventType =
  | "checkout.session.completed"
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "customer.subscription.trial_will_end"
  | "invoice.paid"
  | "invoice.payment_failed";

type StripeEventEnvelope = {
  id: string;
  type: string;
  data: { object: unknown };
};

type StripeSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

type StripeSubscriptionItem = {
  id: string;
  quantity: number;
  price: { id: string };
};

type StripeSubscription = {
  id: string;
  customer: string;
  status: StripeSubscriptionStatus;
  current_period_start: number | null;
  current_period_end: number | null;
  trial_start: number | null;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  items: { data: StripeSubscriptionItem[] };
  metadata?: Record<string, string>;
};

type StripeCheckoutSession = {
  id: string;
  mode: "subscription" | "payment" | "setup";
  customer: string | null;
  subscription: string | null;
  metadata?: Record<string, string>;
};

type StripeInvoice = {
  id: string;
  customer: string;
  subscription: string | null;
  status: string;
  period_start: number | null;
  period_end: number | null;
  paid: boolean;
  attempt_count: number;
  metadata?: Record<string, string>;
};

type OrgPriceMap = {
  standardBaseMonthly: string;
  standardBaseYearly: string;
  extraSeatMonthly: string;
  extraSeatYearly: string;
  aiBoostMonthly: string;
  aiBoostYearly: string;
};

type WebhookConfig = {
  secret: string;
  addonPriceId: string;
  orgPrices: OrgPriceMap;
};

type PlanTier = "standard" | "standard_pro";
type PlanCycle = "monthly" | "yearly";

type ParsedOrgSubscription = {
  tier: PlanTier;
  cycle: PlanCycle;
  seatCount: number;
  aiBoostEnabled: boolean;
  itemIds: {
    base: string | null;
    extraSeat: string | null;
    aiBoost: string | null;
  };
};

// ============================================
// 署名 検証
// ============================================

function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): { ok: true; timestamp: number } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "no_header" };
  const parts = header.split(",").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return { ok: false, reason: "malformed" };
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SEC) {
    return { ok: false, reason: "stale" };
  }
  const signed = `${t}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, timestamp };
}

// ============================================
// 設定 読 込
// ============================================

function loadConfig(): WebhookConfig | { error: string } {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const addonPriceId = process.env.STRIPE_PRICE_MEETING_RECORDING_AUTO;
  const orgPrices: OrgPriceMap = {
    standardBaseMonthly: process.env.STRIPE_PRICE_STANDARD_BASE_MONTHLY ?? "",
    standardBaseYearly: process.env.STRIPE_PRICE_STANDARD_BASE_YEARLY ?? "",
    extraSeatMonthly: process.env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY ?? "",
    extraSeatYearly: process.env.STRIPE_PRICE_EXTRA_SEAT_YEARLY ?? "",
    aiBoostMonthly: process.env.STRIPE_PRICE_AI_BOOST_MONTHLY ?? "",
    aiBoostYearly: process.env.STRIPE_PRICE_AI_BOOST_YEARLY ?? "",
  };
  if (!secret || !addonPriceId) return { error: "core_not_configured" };
  const missingOrg = Object.entries(orgPrices)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missingOrg.length > 0) {
    return { error: `org_prices_missing:${missingOrg.join(",")}` };
  }
  return { secret, addonPriceId, orgPrices };
}

// ============================================
// line items → tier / seat / ai_boost 判定 + item ID 抽出
// ============================================

function parseOrgSubscription(
  sub: StripeSubscription,
  prices: OrgPriceMap,
): ParsedOrgSubscription | null {
  let hasBase = false;
  let cycle: PlanCycle = "monthly";
  let seatCount = 0;
  let aiBoostEnabled = false;
  let baseItemId: string | null = null;
  let extraSeatItemId: string | null = null;
  let aiBoostItemId: string | null = null;

  for (const item of sub.items.data) {
    const priceId = item.price.id;
    const qty = Math.max(0, Number(item.quantity) || 0);

    if (priceId === prices.standardBaseMonthly) {
      hasBase = true;
      cycle = "monthly";
      baseItemId = item.id;
    } else if (priceId === prices.standardBaseYearly) {
      hasBase = true;
      cycle = "yearly";
      baseItemId = item.id;
    } else if (priceId === prices.extraSeatMonthly || priceId === prices.extraSeatYearly) {
      seatCount += qty;
      extraSeatItemId = item.id;
    } else if (priceId === prices.aiBoostMonthly || priceId === prices.aiBoostYearly) {
      aiBoostEnabled = true;
      aiBoostItemId = item.id;
    }
  }

  if (!hasBase) return null;

  return {
    tier: aiBoostEnabled ? "standard_pro" : "standard",
    cycle,
    seatCount,
    aiBoostEnabled,
    itemIds: {
      base: baseItemId,
      extraSeat: extraSeatItemId,
      aiBoost: aiBoostItemId,
    },
  };
}

type OrgPlanStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete";

function mapOrgPlanStatus(s: StripeSubscriptionStatus, deleted: boolean): OrgPlanStatus {
  if (deleted) return "canceled";
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "incomplete";
  }
}

// ============================================
// Idempotency 補助 (stripe_events テーブル)
// ============================================

type AdminClient = ReturnType<typeof createServiceClient>;

async function claimEvent(
  admin: AdminClient,
  eventId: string,
  eventType: string,
): Promise<"claimed" | "duplicate"> {
  const { error } = await admin.from("stripe_events").insert({ id: eventId, type: eventType });
  if (error) {
    // 23505 = unique_violation → 二重 配信
    if ((error as { code?: string }).code === "23505") return "duplicate";
    // その 他 の エラー は 一旦 duplicate 扱い で 二重 処理 を 避ける (fail-safe)
    return "duplicate";
  }
  return "claimed";
}

async function markEventProcessed(
  admin: AdminClient,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  errorMessage: string | null,
): Promise<void> {
  await admin
    .from("stripe_events")
    .update({
      processed_at: new Date().toISOString(),
      status,
      error_message: errorMessage,
    })
    .eq("id", eventId);
}

async function isOrgExempt(admin: AdminClient, organizationId: string): Promise<boolean> {
  const { data } = await admin
    .from("organization_plans")
    .select("is_billing_exempt")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return Boolean(data?.is_billing_exempt);
}

// ============================================
// 各 event ハンドラ
// ============================================

async function handleCheckoutCompleted(
  admin: AdminClient,
  session: StripeCheckoutSession,
): Promise<{ ok: boolean; reason?: string }> {
  const scope = session.metadata?.scope;
  const orgId = session.metadata?.organization_id;

  if (scope !== "organization") return { ok: true, reason: "not_organization_scope" };
  if (!orgId) return { ok: false, reason: "missing_organization_id" };
  if (session.mode !== "subscription") return { ok: true, reason: "not_subscription_mode" };
  if (!session.subscription || !session.customer) {
    return { ok: false, reason: "missing_customer_or_subscription" };
  }

  const exempt = await isOrgExempt(admin, orgId);
  if (exempt) {
    console.warn(
      `[stripe-webhook] Checkout completed for exempt org ${orgId}, subscription=${session.subscription}`,
    );
  }

  const { error } = await admin
    .from("organization_plans")
    .update({
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId);
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };
  return { ok: true };
}

async function handleSubscriptionSync(
  admin: AdminClient,
  sub: StripeSubscription,
  eventType: StripeEventType,
  eventId: string,
  prices: OrgPriceMap,
): Promise<{ ok: boolean; reason?: string }> {
  const scope = sub.metadata?.scope;
  const orgId = sub.metadata?.organization_id;

  if (scope !== "organization") return { ok: true, reason: "not_organization_scope" };
  if (!orgId) return { ok: false, reason: "missing_organization_id" };

  const parsed = parseOrgSubscription(sub, prices);
  if (!parsed) return { ok: false, reason: "no_base_line_item" };

  const deleted = eventType === "customer.subscription.deleted";
  const status = mapOrgPlanStatus(sub.status, deleted);

  const toIso = (unix: number | null): string | null =>
    unix ? new Date(unix * 1000).toISOString() : null;

  const nextBilledAt = sub.cancel_at_period_end ? null : toIso(sub.current_period_end);

  const exempt = await isOrgExempt(admin, orgId);
  if (exempt) {
    console.warn(
      `[stripe-webhook] Subscription ${sub.id} event ${eventType} for exempt org ${orgId}`,
    );
  }

  // seat_count は 「管理者 含めた 総 席 数」 で、 line item の quantity は
  // Extra Seat = seat_count - 3 (Base に 3 席 込 み)。 DB に は 総 席 数 を 保存 する。
  const totalSeats = parsed.seatCount + 3;

  const { error } = await admin
    .from("organization_plans")
    .update({
      tier: parsed.tier,
      cycle: parsed.cycle,
      status,
      seat_count: totalSeats,
      ai_boost_enabled: parsed.aiBoostEnabled,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      stripe_subscription_item_id_base: parsed.itemIds.base,
      stripe_subscription_item_id_extra_seat: parsed.itemIds.extraSeat,
      stripe_subscription_item_id_ai_boost: parsed.itemIds.aiBoost,
      trial_started_at: toIso(sub.trial_start),
      trial_ends_at: toIso(sub.trial_end),
      current_period_start: toIso(sub.current_period_start),
      current_period_end: toIso(sub.current_period_end),
      next_billed_at: nextBilledAt,
      canceled_at: deleted ? new Date().toISOString() : toIso(sub.canceled_at),
      last_stripe_event_id: eventId,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId);
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };
  return { ok: true };
}

async function handleTrialWillEnd(
  admin: AdminClient,
  sub: StripeSubscription,
): Promise<{ ok: boolean; reason?: string }> {
  const scope = sub.metadata?.scope;
  const orgId = sub.metadata?.organization_id;
  if (scope !== "organization" || !orgId) return { ok: true, reason: "not_organization_scope" };

  // TODO(後続): admin 宛て メール 通知。 ここ で は last_synced_at のみ 更新。
  console.info(
    `[stripe-webhook] Trial will end for org=${orgId}, subscription=${sub.id}, trial_end=${sub.trial_end}`,
  );
  await admin
    .from("organization_plans")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("organization_id", orgId);
  return { ok: true };
}

async function handleInvoicePaid(
  admin: AdminClient,
  invoice: StripeInvoice,
): Promise<{ ok: boolean; reason?: string }> {
  const scope = invoice.metadata?.scope;
  const orgId = invoice.metadata?.organization_id;
  if (scope !== "organization" || !orgId) return { ok: true, reason: "not_organization_scope" };
  if (!invoice.subscription) return { ok: true, reason: "no_subscription" };

  const periodStart = invoice.period_start
    ? new Date(invoice.period_start * 1000).toISOString()
    : null;
  const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null;

  const { error } = await admin
    .from("organization_plans")
    .update({
      status: "active",
      current_period_start: periodStart,
      current_period_end: periodEnd,
      last_synced_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .in("status", ["active", "past_due", "trialing"]);
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };
  console.info(`[stripe-webhook] Invoice paid for org=${orgId}, invoice=${invoice.id}`);
  return { ok: true };
}

async function handleInvoicePaymentFailed(
  admin: AdminClient,
  invoice: StripeInvoice,
): Promise<{ ok: boolean; reason?: string }> {
  const scope = invoice.metadata?.scope;
  const orgId = invoice.metadata?.organization_id;
  if (scope !== "organization" || !orgId) return { ok: true, reason: "not_organization_scope" };

  const { error } = await admin
    .from("organization_plans")
    .update({
      status: "past_due",
      last_synced_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .neq("status", "canceled");
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };

  console.warn(
    `[stripe-webhook] Invoice payment failed org=${orgId}, invoice=${invoice.id}, attempt=${invoice.attempt_count}`,
  );
  return { ok: true };
}

// ============================================
// 既存 の addon 処理 (subscription_addons)
// metadata.scope が "organization" で 無い ケース にのみ 走る。
// ============================================

async function handleAddonSubscription(
  admin: AdminClient,
  sub: StripeSubscription,
  eventType: StripeEventType,
  addonPriceId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const item = sub.items.data.find((i) => i.price.id === addonPriceId);
  if (!item) return { ok: true, reason: "no_addon_item" };
  const userId = sub.metadata?.user_id;
  if (!userId) return { ok: false, reason: "missing_user_id_metadata" };

  const status: "active" | "past_due" | "canceled" =
    eventType === "customer.subscription.deleted"
      ? "canceled"
      : sub.status === "active" || sub.status === "trialing"
        ? "active"
        : sub.status === "past_due"
          ? "past_due"
          : "canceled";

  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const { error } = await admin.from("subscription_addons").upsert(
    {
      user_id: userId,
      addon_key: "meeting_recording_auto",
      status,
      stripe_subscription_item_id: item.id,
      stripe_customer_id: sub.customer,
      current_period_end: currentPeriodEnd,
    },
    { onConflict: "user_id,addon_key" },
  );
  if (error) return { ok: false, reason: `db_upsert_failed:${error.message}` };
  return { ok: true };
}

// ============================================
// POST エントリ
// ============================================

export async function POST(request: Request): Promise<Response> {
  const cfg = loadConfig();
  if ("error" in cfg) {
    return NextResponse.json({ error: "not_configured", detail: cfg.error }, { status: 503 });
  }

  const raw = await request.text();
  const verified = verifyStripeSignature(raw, request.headers.get("stripe-signature"), cfg.secret);
  if (!verified.ok) {
    return NextResponse.json({ error: "bad_signature", reason: verified.reason }, { status: 401 });
  }

  let event: StripeEventEnvelope;
  try {
    event = JSON.parse(raw) as StripeEventEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const admin = createServiceClient();

  // Idempotency: 同じ event.id は 2 回 処理 しない
  const claim = await claimEvent(admin, event.id, event.type);
  if (claim === "duplicate") {
    return NextResponse.json({ ok: true, idempotent: true, event_id: event.id });
  }

  const type = event.type as StripeEventType;

  try {
    if (type === "checkout.session.completed") {
      const session = event.data.object as StripeCheckoutSession;
      const r = await handleCheckoutCompleted(admin, session);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
      return NextResponse.json({ ok: true, kind: "checkout" });
    }

    if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as StripeSubscription;
      const scope = sub.metadata?.scope;
      const r =
        scope === "organization"
          ? await handleSubscriptionSync(admin, sub, type, event.id, cfg.orgPrices)
          : await handleAddonSubscription(admin, sub, type, cfg.addonPriceId);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
      return NextResponse.json({ ok: true, kind: scope === "organization" ? "org" : "addon" });
    }

    if (type === "customer.subscription.trial_will_end") {
      const sub = event.data.object as StripeSubscription;
      const r = await handleTrialWillEnd(admin, sub);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      return NextResponse.json({ ok: r.ok, kind: "trial_will_end" });
    }

    if (type === "invoice.paid") {
      const invoice = event.data.object as StripeInvoice;
      const r = await handleInvoicePaid(admin, invoice);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      return NextResponse.json({ ok: r.ok, kind: "invoice_paid" });
    }

    if (type === "invoice.payment_failed") {
      const invoice = event.data.object as StripeInvoice;
      const r = await handleInvoicePaymentFailed(admin, invoice);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      return NextResponse.json({ ok: r.ok, kind: "invoice_failed" });
    }

    // その 他 は 無視
    await markEventProcessed(admin, event.id, "ignored", null);
    return NextResponse.json({ ignored: event.type });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await markEventProcessed(admin, event.id, "failed", msg);
    // 500 を 返す と Stripe が 自動 リトライ する
    return NextResponse.json({ error: "handler_exception", message: msg }, { status: 500 });
  }
}
