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
  // Stripe 側 で イベント が 作成 された Unix 秒。 順序 逆転 検知 用。
  created: number;
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
  // Stripe は 「t=...,v1=...,v1=...」 の 形式 で 複数 v1 を 送りうる
  // (Webhook Signing Secret ローテーション 中 は 新旧 両方 の 署名 が 並ぶ)。
  // Record に 畳み込む と 後勝ち で 1 つ しか 検証 できず、 ロール 中 に 旧 secret
  // 側 の 署名 が 401 で 弾かれる。 v1 は 配列 で 保持 して いずれか 一致 で OK とする。
  let t: string | null = null;
  const v1s: string[] = [];
  for (const kv of header.split(",")) {
    const eqIdx = kv.indexOf("=");
    if (eqIdx < 0) continue;
    const k = kv.slice(0, eqIdx).trim();
    const v = kv.slice(eqIdx + 1).trim();
    if (!v) continue;
    if (k === "t") t = v;
    else if (k === "v1") v1s.push(v);
  }
  if (!t || v1s.length === 0) return { ok: false, reason: "malformed" };
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SEC) {
    return { ok: false, reason: "stale" };
  }
  const signed = `${t}.${rawBody}`;
  const expected = Buffer.from(createHmac("sha256", secret).update(signed).digest("hex"));
  for (const v1 of v1s) {
    const candidate = Buffer.from(v1);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true, timestamp };
    }
  }
  return { ok: false, reason: "bad_signature" };
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

type ParseOrgSubscriptionResult =
  | { ok: true; parsed: ParsedOrgSubscription }
  | { ok: false; reason: string };

function parseOrgSubscription(
  sub: StripeSubscription,
  prices: OrgPriceMap,
): ParseOrgSubscriptionResult {
  let hasBase = false;
  let cycle: PlanCycle = "monthly";
  let seatCount = 0;
  let aiBoostEnabled = false;
  let baseItemId: string | null = null;
  let extraSeatItemId: string | null = null;
  let aiBoostItemId: string | null = null;
  const unknownPriceIds: string[] = [];

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
    } else {
      unknownPriceIds.push(priceId);
    }
  }

  if (!hasBase) return { ok: false, reason: "no_base_line_item" };

  // 未知 price_id が 混ざって いる 場合 は env の 更新 忘れ (テスト → 本番 切替 で
  // Price ID が 変わった 等) の 可能性 が 高い。 silent-skip する と Stripe と DB
  // の seat_count が 乖離 する の で 500 で 弾き、 Stripe に リトライ させる +
  // ログ で 気付ける ように する。
  if (unknownPriceIds.length > 0) {
    console.error(
      `[stripe-webhook] parseOrgSubscription: unknown price_ids in subscription ${sub.id}: ${unknownPriceIds.join(", ")}. env の STRIPE_PRICE_* を 確認 して ください。`,
    );
    return { ok: false, reason: `unknown_price_ids:${unknownPriceIds.join(",")}` };
  }

  return {
    ok: true,
    parsed: {
      tier: aiBoostEnabled ? "standard_pro" : "standard",
      cycle,
      seatCount,
      aiBoostEnabled,
      itemIds: {
        base: baseItemId,
        extraSeat: extraSeatItemId,
        aiBoost: aiBoostItemId,
      },
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
  if (!error) return "claimed";
  // 23505 = unique_violation → 本当 の 二重 配信 な の で 200 で 返して OK
  if ((error as { code?: string }).code === "23505") return "duplicate";
  // それ 以外 の エラー (DB 一過性 障害 等) は throw して 外側 catch で 500 を 返し、
  // Stripe に 再送 させる。 duplicate 扱い すると event を 永久 ロスト する。
  throw new Error(`stripe_events insert failed: ${error.message}`);
}

/**
 * 失敗 時 (500 応答) に 呼ぶ。 claim 済み の event 行 を 削除 して、
 * Stripe の 次回 リトライ で 再度 claim できる ように する。
 * これ を 怠る と リトライ が 常 に 23505 (duplicate) で 握り 潰される。
 */
async function releaseEventClaim(admin: AdminClient, eventId: string): Promise<void> {
  await admin.from("stripe_events").delete().eq("id", eventId);
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

  // 免除 組織 は DB を 一切 触ら ない。 マイグレーション header の 契約
  // 「is_billing_exempt=true の組織 は Webhook でも Item ID を 埋め ない」 を 満たす。
  const exempt = await isOrgExempt(admin, orgId);
  if (exempt) {
    console.warn(
      `[stripe-webhook] Checkout skipped for exempt org ${orgId}, subscription=${session.subscription}`,
    );
    return { ok: true, reason: "org_is_exempt" };
  }

  // M3 修正: organization_plans 行 が 存在 しない 組織 は upsert で 補完 する。
  // 従来 は .update() で 0 row silent skip → Stripe 課金 開始 済 なのに DB 未反映
  // という 不整合 が 発生 する 可能性 が あった。 subscription.updated 側 で 本 更新
  // が 走る が、 それ より 前 に 参照 された 場合 に UI が 空 に なる の を 防ぐ。
  const { error } = await admin.from("organization_plans").upsert(
    {
      organization_id: orgId,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };
  return { ok: true };
}

async function handleSubscriptionSync(
  admin: AdminClient,
  sub: StripeSubscription,
  eventType: StripeEventType,
  eventId: string,
  eventCreatedAtSec: number,
  prices: OrgPriceMap,
): Promise<{ ok: boolean; reason?: string }> {
  const scope = sub.metadata?.scope;
  const orgId = sub.metadata?.organization_id;

  if (scope !== "organization") return { ok: true, reason: "not_organization_scope" };
  if (!orgId) return { ok: false, reason: "missing_organization_id" };

  const parseResult = parseOrgSubscription(sub, prices);
  if (!parseResult.ok) {
    // no_base_line_item は 400 (顧客 側 の 問題 な の で リトライ 意味 無し)、
    // unknown_price_ids は 500 に 昇格 して リトライ + アラート させたい が、
    // 現状 の 呼び出し 契約 で は reason を 単一 文字列 で 返す 仕様。 呼び出し 元
    // (POST の releaseOnRetryable) が unknown_price_ids で 検出 して リリース する
    // よう に、 db_update_failed と 同じ プレフィックス 扱い に すべきか は 別途。
    // ここ で は 忠実 に 理由 を 返す だけ。
    return { ok: false, reason: parseResult.reason };
  }
  const parsed = parseResult.parsed;

  // 免除 組織 は plan を 一切 触ら ない (マイグレーション header の 契約)
  const exempt = await isOrgExempt(admin, orgId);
  if (exempt) {
    console.warn(
      `[stripe-webhook] Subscription sync skipped for exempt org ${orgId}, event=${eventType}`,
    );
    return { ok: true, reason: "org_is_exempt" };
  }

  // H2 + M3 修正: SELECT+UPDATE の check-then-update だと 行 ロック が 無く、
  // Stripe が バースト 配信 した 際 に 両 lambda が stale ゲート を 通過 して
  // 後勝ち で 古い スナップ ショット が 残る 恐れ が あった。 また 組織 作成 時 の
  // organization_plans insert が 失敗 して いる 組織 では UPDATE が 0 row silent
  // skip に なり Stripe 課金 だけ 開始 する バグ が あった。
  // apply_stripe_subscription_sync RPC は SELECT FOR UPDATE + UPSERT + idempotency
  // を 一体 で 処理 する ため、 両 問題 を 同時 に 解消 できる。
  const eventIsoAt = new Date(eventCreatedAtSec * 1000).toISOString();
  const deleted = eventType === "customer.subscription.deleted";
  const status = mapOrgPlanStatus(sub.status, deleted);

  const toIso = (unix: number | null): string | null =>
    unix ? new Date(unix * 1000).toISOString() : null;

  const nextBilledAt = sub.cancel_at_period_end ? null : toIso(sub.current_period_end);

  // seat_count は 「管理者 含めた 総 席 数」 で、 line item の quantity は
  // Extra Seat = seat_count - 3 (Base に 3 席 込 み)。 DB に は 総 席 数 を 保存 する。
  const totalSeats = parsed.seatCount + 3;

  const { error } = await admin.rpc("apply_stripe_subscription_sync", {
    p_organization_id: orgId,
    p_event_id: eventId,
    p_event_created_at: eventIsoAt,
    p_tier: parsed.tier,
    p_cycle: parsed.cycle,
    p_status: status,
    p_seat_count: totalSeats,
    p_ai_boost_enabled: parsed.aiBoostEnabled,
    p_stripe_customer_id: sub.customer,
    p_stripe_subscription_id: sub.id,
    p_stripe_item_base: parsed.itemIds.base,
    p_stripe_item_extra_seat: parsed.itemIds.extraSeat,
    p_stripe_item_ai_boost: parsed.itemIds.aiBoost,
    p_current_period_start: toIso(sub.current_period_start),
    p_current_period_end: toIso(sub.current_period_end),
    p_next_billed_at: nextBilledAt,
    p_canceled_at: deleted ? new Date().toISOString() : toIso(sub.canceled_at),
  });
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };

  // RPC の 引数 に 含まれ ない trial 日時 は、 通過 (idempotency ゲート 通過) 後 に
  // 別 UPDATE で 補完 する。 event 順序 チェック は RPC が last_synced_at を 更新
  // した 直後 なので、 このタイミング で 上書き して 安全。
  const trialStart = toIso(sub.trial_start);
  const trialEnd = toIso(sub.trial_end);
  if (trialStart !== null || trialEnd !== null) {
    await admin
      .from("organization_plans")
      .update({ trial_started_at: trialStart, trial_ends_at: trialEnd })
      .eq("organization_id", orgId)
      .eq("last_stripe_event_id", eventId);
  }
  return { ok: true };
}

async function handleTrialWillEnd(
  admin: AdminClient,
  sub: StripeSubscription,
): Promise<{ ok: boolean; reason?: string }> {
  const scope = sub.metadata?.scope;
  const orgId = sub.metadata?.organization_id;
  if (scope !== "organization" || !orgId) return { ok: true, reason: "not_organization_scope" };

  if (await isOrgExempt(admin, orgId)) return { ok: true, reason: "org_is_exempt" };

  // TODO(後続): admin 宛て メール 通知。 現状 は ログ のみ (last_synced_at は
  //   subscription.updated 側 で 順序 保証 付き で 更新 する ので ここ では 触ら ない)。
  console.warn(
    `[stripe-webhook] Trial will end for org=${orgId}, subscription=${sub.id}, trial_end=${sub.trial_end}`,
  );
  return { ok: true };
}

/**
 * invoice event から organization_id を 逆引き する。
 *
 * M2 修正 の 背景: Stripe は subscription.metadata を invoice.metadata に コピー
 * しない 仕様 の ため、 従来 の `invoice.metadata.scope === "organization"` チェック
 * は 常 に false と なり silent skip して いた。
 * 代替 と して invoice.subscription を 使い organization_plans を 逆引き する。
 */
async function resolveOrgIdFromInvoice(
  admin: AdminClient,
  invoice: StripeInvoice,
): Promise<string | null> {
  if (!invoice.subscription) return null;
  const { data } = await admin
    .from("organization_plans")
    .select("organization_id")
    .eq("stripe_subscription_id", invoice.subscription)
    .maybeSingle();
  return data?.organization_id ?? null;
}

async function handleInvoicePaid(
  admin: AdminClient,
  invoice: StripeInvoice,
): Promise<{ ok: boolean; reason?: string }> {
  const orgId = await resolveOrgIdFromInvoice(admin, invoice);
  if (!orgId) return { ok: true, reason: "no_org_link" };

  if (await isOrgExempt(admin, orgId)) return { ok: true, reason: "org_is_exempt" };

  const periodStart = invoice.period_start
    ? new Date(invoice.period_start * 1000).toISOString()
    : null;
  const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null;

  // M3 修正: .select("organization_id") で 影響 行数 を 検知 し、
  // 0 row (organization_plans が 未作成) の 場合 は 明示 的 に silent_skip を 返す。
  // subscription.updated 側 で 状態 更新 が 走る ため、 ここ で は fatal 化 し ない。
  const { data, error } = await admin
    .from("organization_plans")
    .update({
      status: "active",
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })
    .eq("organization_id", orgId)
    .in("status", ["active", "past_due", "trialing"])
    .select("organization_id");
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };
  if (!data || data.length === 0) {
    console.warn(
      `[stripe-webhook] Invoice paid but no matching plan row org=${orgId}, invoice=${invoice.id}`,
    );
    return { ok: true, reason: "no_plan_row_or_status_gate" };
  }
  console.warn(`[stripe-webhook] Invoice paid for org=${orgId}, invoice=${invoice.id}`);
  return { ok: true };
}

async function handleInvoicePaymentFailed(
  admin: AdminClient,
  invoice: StripeInvoice,
): Promise<{ ok: boolean; reason?: string }> {
  const orgId = await resolveOrgIdFromInvoice(admin, invoice);
  if (!orgId) return { ok: true, reason: "no_org_link" };

  if (await isOrgExempt(admin, orgId)) return { ok: true, reason: "org_is_exempt" };

  const { data, error } = await admin
    .from("organization_plans")
    .update({
      status: "past_due",
    })
    .eq("organization_id", orgId)
    .neq("status", "canceled")
    .select("organization_id");
  if (error) return { ok: false, reason: `db_update_failed:${error.message}` };
  if (!data || data.length === 0) {
    console.warn(
      `[stripe-webhook] Invoice payment failed but no matching plan row org=${orgId}, invoice=${invoice.id}`,
    );
    return { ok: true, reason: "no_plan_row_or_canceled" };
  }
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
  if (!userId) {
    // Dashboard 直挿し 等 で metadata.user_id が 無い subscription が 来た 場合、
    // 400 で 返す と 「claim 済み + 500 じゃ ない」 で 以降 の リトライ が duplicate
    // 化 して 握り 潰され、 その 契約 の cancel 検知 も 漏れる。 意図 的 に 無視 して
    // ignored として 記録 する 方 が 安全 (未知 契約 は そもそも 追跡 対象 外)。
    console.warn(`[stripe-webhook] addon subscription ${sub.id} lacks metadata.user_id — ignored`);
    return { ok: true, reason: "no_user_id_metadata" };
  }

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

  // Idempotency: 同じ event.id は 2 回 処理 しない。 claimEvent 失敗 (DB 一過性
  // 障害) は throw され て 外側 catch で 500 + releaseEventClaim に 落ちる。
  let claim: "claimed" | "duplicate";
  try {
    claim = await claimEvent(admin, event.id, event.type);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "claim_failed", message: msg }, { status: 500 });
  }
  if (claim === "duplicate") {
    return NextResponse.json({ ok: true, idempotent: true, event_id: event.id });
  }

  const type = event.type as StripeEventType;

  /** ハンドラ が db_update_failed を 返した とき、 claim 行 を 削除 して
   *  Stripe の 次回 リトライ で 再度 処理 させる。 200/400 は claim 行 を 残す
   *  (成功 済み or 意図的な reject な の で リトライ 不要)。 */
  const releaseOnRetryable = async (reason: string | null) => {
    if (reason && reason.startsWith("db_update_failed")) {
      await releaseEventClaim(admin, event.id);
    }
  };

  try {
    if (type === "checkout.session.completed") {
      const session = event.data.object as StripeCheckoutSession;
      const r = await handleCheckoutCompleted(admin, session);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      if (!r.ok) {
        await releaseOnRetryable(r.reason ?? null);
        return NextResponse.json({ error: r.reason }, { status: 400 });
      }
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
          ? await handleSubscriptionSync(admin, sub, type, event.id, event.created, cfg.orgPrices)
          : await handleAddonSubscription(admin, sub, type, cfg.addonPriceId);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      if (!r.ok) {
        await releaseOnRetryable(r.reason ?? null);
        return NextResponse.json({ error: r.reason }, { status: 400 });
      }
      return NextResponse.json({ ok: true, kind: scope === "organization" ? "org" : "addon" });
    }

    if (type === "customer.subscription.trial_will_end") {
      const sub = event.data.object as StripeSubscription;
      const r = await handleTrialWillEnd(admin, sub);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      if (!r.ok) await releaseOnRetryable(r.reason ?? null);
      return NextResponse.json({ ok: r.ok, kind: "trial_will_end" });
    }

    if (type === "invoice.paid") {
      const invoice = event.data.object as StripeInvoice;
      const r = await handleInvoicePaid(admin, invoice);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      if (!r.ok) await releaseOnRetryable(r.reason ?? null);
      return NextResponse.json({ ok: r.ok, kind: "invoice_paid" });
    }

    if (type === "invoice.payment_failed") {
      const invoice = event.data.object as StripeInvoice;
      const r = await handleInvoicePaymentFailed(admin, invoice);
      await markEventProcessed(admin, event.id, r.ok ? "processed" : "failed", r.reason ?? null);
      if (!r.ok) await releaseOnRetryable(r.reason ?? null);
      return NextResponse.json({ ok: r.ok, kind: "invoice_failed" });
    }

    // その 他 は 無視
    await markEventProcessed(admin, event.id, "ignored", null);
    return NextResponse.json({ ignored: event.type });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // ハンドラ 内 例外 は 一過性 DB / Stripe 障害 の 可能性 が 高い の で
    // claim 行 を 削除 して Stripe の リトライ を 受け 付ける。
    await releaseEventClaim(admin, event.id);
    console.error(`[stripe-webhook] handler exception event=${event.id}: ${msg}`);
    return NextResponse.json({ error: "handler_exception", message: msg }, { status: 500 });
  }
}
