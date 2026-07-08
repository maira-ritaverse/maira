/**
 * POST /api/agency/billing/boost   → AI Boost を 有効 化 (Standard → Pro)
 * DELETE /api/agency/billing/boost → AI Boost を 無効 化 (Pro → Standard)
 *
 * admin 専用。 課金 免除 中 は 拒否。 subscription 未 契約 も 拒否。
 *
 * 実装:
 *   ・POST: addSubscriptionItem(AI Boost price) → tier を standard_pro に、
 *           ai_boost_enabled=true、 stripe_subscription_item_id_ai_boost 保存
 *   ・DELETE: removeSubscriptionItem(既存 item_id) → tier を standard に、
 *            ai_boost_enabled=false、 item_id を NULL に
 *   ・DB 反映 は 本 route と Webhook の 両方 で 行われ る が、
 *     apply_stripe_subscription_sync RPC の idempotency ゲート で 重複 更新 は 弾かれる
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getBillingExemption } from "@/lib/billing/exemption";
import {
  addSubscriptionItem,
  getOrgStripeConfig,
  removeSubscriptionItem,
  retrieveSubscription,
} from "@/lib/integrations/stripe";
import { createServiceClient } from "@/lib/supabase/service";

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
    .select(
      "stripe_subscription_id, stripe_subscription_item_id_ai_boost, cycle, ai_boost_enabled, status, canceled_at",
    )
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!plan?.stripe_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }
  if (plan.ai_boost_enabled) {
    return NextResponse.json({ error: "already_enabled" }, { status: 409 });
  }

  // 状態 ガード: active / trialing 以外 で は Boost 追加 させ ない
  //   ・past_due → 支払 失敗 中。 未 払 残高 が 膨らむ の で Portal で 復旧 が 先
  //   ・canceled → もう 契約 が 無い
  //   ・incomplete → 初回 決済 未 完了。 まず Portal で 決済 完了 させる
  //   ・cancel_at_period_end=true → 期末 停止 予定 の 契約 に item 追加 は 矛盾
  if (plan.status !== "active" && plan.status !== "trialing") {
    return NextResponse.json(
      {
        error: "invalid_status",
        message: `現在 の 状態 (${plan.status}) では AI Boost を 追加 でき ません。 まず Billing Portal で 支払 情報 を 更新 して ください。`,
      },
      { status: 409 },
    );
  }
  if (plan.canceled_at !== null) {
    return NextResponse.json(
      {
        error: "pending_cancel",
        message:
          "解約 予約 中 の 契約 に は AI Boost を 追加 できません。 先 に 「解約 予約 を 取り 消す」 で 継続 して ください。",
      },
      { status: 409 },
    );
  }

  // cycle 突合: DB の cycle と Stripe subscription 実 line item の interval が
  //   一致 する か 確認 する。 Checkout 直後 の 数秒 は Webhook 未 反映 で 両者 が
  //   ズレる 可能性 が あり、 monthly base に yearly Boost item を 混ぜる と
  //   billing_cycle が 契約 内 で 不整合 に なる。
  try {
    const sub = await retrieveSubscription(config, plan.stripe_subscription_id);
    const baseItem = sub.items.data.find(
      (i) =>
        i.price.id === config.prices.standardBaseMonthly ||
        i.price.id === config.prices.standardBaseYearly,
    );
    const actualCycle: "monthly" | "yearly" | null = baseItem
      ? baseItem.price.id === config.prices.standardBaseYearly
        ? "yearly"
        : "monthly"
      : null;
    if (!actualCycle) {
      return NextResponse.json({ error: "no_base_item_in_stripe" }, { status: 409 });
    }
    if (actualCycle !== plan.cycle) {
      return NextResponse.json(
        {
          error: "cycle_mismatch",
          message:
            "契約 状態 の 同期 中 です。 数 秒 待って から 再 実行 して ください (Stripe と DB の cycle が 一時 的 に 乖離)。",
          db_cycle: plan.cycle,
          stripe_cycle: actualCycle,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stripe_retrieve_failed", detail: msg }, { status: 502 });
  }

  const priceId =
    plan.cycle === "yearly" ? config.prices.aiBoostYearly : config.prices.aiBoostMonthly;

  try {
    const created = await addSubscriptionItem(config, {
      subscriptionId: plan.stripe_subscription_id,
      priceId,
      quantity: 1,
      prorationBehavior: "create_prorations",
      // 同 subscription × 同 price で 冪等
      idempotencyKey: `ai-boost-add:${plan.stripe_subscription_id}:${priceId}`,
    });

    // DB 反映 (Webhook でも 反映 され るが、 UI 即応 の ため 先 に 更新)
    // M4 修正: last_synced_at を 現在時刻 で 番兵 更新 する。 Stripe が この API
    // 呼び出し 前 に 生成 した 古い customer.subscription.updated (event.created <
    // now()) が 順序 逆転 で 到着 して も RPC の stale ゲート で 弾かれる ように する。
    const admin = createServiceClient();
    await admin
      .from("organization_plans")
      .update({
        stripe_subscription_item_id_ai_boost: created.id,
        ai_boost_enabled: true,
        tier: "standard_pro",
        last_synced_at: new Date().toISOString(),
      })
      .eq("organization_id", organization.id);

    return NextResponse.json({ ok: true, itemId: created.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stripe_error", detail: msg }, { status: 502 });
  }
}

export async function DELETE() {
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
    .select("stripe_subscription_item_id_ai_boost, ai_boost_enabled, status")
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!plan?.stripe_subscription_item_id_ai_boost) {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }

  // 状態 ガード: canceled は 既 に 契約 が 無い の で Stripe が 400 を 返す。
  //   その 手前 で 意味 の 通る メッセージ を 返す。 past_due / incomplete は
  //   ダウングレード 自体 は 有効 な の で 通す (支払 復旧 中 でも 節約 の 意思 は 尊重)。
  if (plan.status === "canceled") {
    return NextResponse.json(
      {
        error: "already_canceled",
        message: "契約 が 既 に 終了 して います。 AI Boost 単体 での 無効 化 は でき ません。",
      },
      { status: 409 },
    );
  }

  try {
    await removeSubscriptionItem(config, {
      subscriptionItemId: plan.stripe_subscription_item_id_ai_boost,
      prorationBehavior: "create_prorations",
    });

    // tier と ai_boost_enabled を 同時 更新 (CHECK 制約 で 整合 が 保た れる)
    // M4 修正: POST 側 と 同じ 理由 で last_synced_at を 番兵 更新。
    const admin = createServiceClient();
    await admin
      .from("organization_plans")
      .update({
        stripe_subscription_item_id_ai_boost: null,
        ai_boost_enabled: false,
        tier: "standard",
        last_synced_at: new Date().toISOString(),
      })
      .eq("organization_id", organization.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stripe_error", detail: msg }, { status: 502 });
  }
}
