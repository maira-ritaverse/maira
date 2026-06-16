import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe からの Webhook を受け取り、「会議録音 自動連携」アドオンの状態を
 * subscription_addons に upsert する。
 *
 * 検証:
 *   ・Stripe-Signature ヘッダを STRIPE_WEBHOOK_SECRET で HMAC-SHA256 検証
 *   ・5 分以内の timestamp のみ受理(リプレイ対策)
 *
 * 対応イベント:
 *   - customer.subscription.created / updated:
 *     ・items[].price.id が STRIPE_PRICE_MEETING_RECORDING_AUTO に一致する行を
 *       検出して subscription_addons に upsert(status / current_period_end)
 *   - customer.subscription.deleted:
 *     ・該当アドオンを canceled に更新
 *
 * 未対応:
 *   ・customer 作成・支払い失敗の細かい遷移(将来 stripe SDK 導入時に拡張)
 */

const TOLERANCE_SEC = 300;

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: StripeSubscription;
  };
};

type StripeSubscription = {
  id: string;
  customer: string;
  status:
    | "active"
    | "trialing"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | "paused";
  current_period_end: number;
  items: {
    data: Array<{
      id: string;
      price: { id: string };
    }>;
  };
  metadata?: Record<string, string>;
};

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

function mapStripeStatus(s: StripeSubscription["status"]): "active" | "past_due" | "canceled" {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due") return "past_due";
  return "canceled";
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const addonPriceId = process.env.STRIPE_PRICE_MEETING_RECORDING_AUTO;
  if (!secret || !addonPriceId) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const raw = await request.text();
  const verified = verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret);
  if (!verified.ok) {
    return NextResponse.json({ error: "bad_signature", reason: verified.reason }, { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // subscription 系のみ扱う
  if (
    event.type !== "customer.subscription.created" &&
    event.type !== "customer.subscription.updated" &&
    event.type !== "customer.subscription.deleted"
  ) {
    return NextResponse.json({ ignored: event.type });
  }

  const sub = event.data.object;
  const item = sub.items.data.find((i) => i.price.id === addonPriceId);
  // この subscription にアドオン Price が含まれない場合は無視(別プラン)
  if (!item) {
    return NextResponse.json({ ignored: "no_addon_item" });
  }

  // user_id は subscription.metadata.user_id か、customer から profiles を引く想定。
  // metadata 経路が一番ロバスト(Checkout 作成時に必ず metadata.user_id を載せる)。
  const userId = sub.metadata?.user_id;
  if (!userId) {
    return NextResponse.json(
      { error: "missing_user_id_metadata", message: "subscription.metadata.user_id が必要" },
      { status: 400 },
    );
  }

  const status =
    event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(sub.status);
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  // Webhook は service_role を使って RLS を跨ぐ
  const admin = createServiceClient();
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
  if (error) {
    return NextResponse.json(
      { error: "db_upsert_failed", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, status, current_period_end: currentPeriodEnd });
}
