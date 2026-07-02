/**
 * POST /api/agency/billing/checkout-session
 *
 * 組織 (エージェント 企業) の Standard / Pro プラン 加入 用 Stripe Checkout Session
 * を 発行 する。 admin 専用。 個人 アドオン 用 /api/billing/checkout-session とは 別。
 *
 * Body: { tier: 'standard' | 'standard_pro', cycle: 'monthly' | 'yearly' }
 *
 * 検証 (順序):
 *   1. requireOrgAdmin — admin 認証
 *   2. Zod body 検証
 *   3. Stripe 設定 (env) の 存在
 *   4. 課金 免除 (is_billing_exempt) の 組織 は 拒否
 *   5. 既存 subscription (active/trialing/past_due/incomplete) は 拒否
 *   6. seat_count = max(members, 3) で 集計
 *   7. createOrgCheckoutSession → URL 返却
 */
import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin } from "@/lib/api/auth-guards";
import { getBillingExemption } from "@/lib/billing/exemption";
import {
  checkoutBodySchema,
  countOrganizationSeats,
  isCheckoutBlockedByStatus,
} from "@/lib/billing/org-checkout";
import { createOrgCheckoutSession, getOrgStripeConfig } from "@/lib/integrations/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 1. admin 認証
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, user, organization } = guard;

  // 2. body 検証
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const bodyResult = checkoutBodySchema.safeParse(parsed.body);
  if (!bodyResult.success) {
    return NextResponse.json(
      {
        error: "invalid_body",
        message: "tier は standard / standard_pro、 cycle は monthly / yearly の いずれか。",
        issues: bodyResult.error.issues,
      },
      { status: 400 },
    );
  }
  const { tier, cycle } = bodyResult.data;

  // 3. Stripe 設定 チェック
  const config = getOrgStripeConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Stripe 組織 プラン の 設定 が サーバ 側 に 登録 されて い ません。 運営 に お問い合わせ ください。",
      },
      { status: 503 },
    );
  }

  // 4. 課金 免除 の 組織 は Checkout に 進ま せ ない
  const exemption = await getBillingExemption(organization.id);
  if (exemption.isExempt) {
    return NextResponse.json(
      {
        error: "billing_exempt",
        message:
          "貴社 は 運営 判断 により 課金 免除 対象 です。 プラン 加入 の 手続き は 不要 です。",
      },
      { status: 409 },
    );
  }

  // 5. 既存 plan の 状態 チェック
  const { data: existingPlan } = await supabase
    .from("organization_plans")
    .select("status, stripe_customer_id, stripe_subscription_id")
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (existingPlan) {
    const blocked = isCheckoutBlockedByStatus(existingPlan.status);
    if (blocked.blocked) {
      return NextResponse.json(
        {
          error: blocked.reason,
          message:
            blocked.reason === "already_subscribed"
              ? "既 に 有効 な プラン に 加入 済 です。 プラン 変更 は Portal から。"
              : blocked.reason === "past_due"
                ? "支払 失敗 中 です。 まず Portal で 支払 方法 を 更新 して ください。"
                : "初期 設定 が 未 完了 です。 前回 の Checkout URL を 再度 開いて 完了 して ください。",
          currentStatus: existingPlan.status,
        },
        { status: 409 },
      );
    }
  }

  // 6. seat 数 集計
  let seatCount = 3;
  try {
    seatCount = await countOrganizationSeats(supabase, organization.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "seat_count_failed", message: msg }, { status: 500 });
  }

  // 7. Checkout Session 作成
  if (!user.email) {
    return NextResponse.json(
      { error: "no_email", message: "ログイン ユーザー に email が 紐付いて い ません。" },
      { status: 400 },
    );
  }

  try {
    const session = await createOrgCheckoutSession(config, {
      organizationId: organization.id,
      tier,
      cycle,
      seatCount,
      adminEmail: user.email,
      existingCustomerId: existingPlan?.stripe_customer_id ?? null,
      idempotencyKey: `org-checkout:${organization.id}:${tier}:${cycle}:${Math.floor(Date.now() / 60000)}`,
    });
    return NextResponse.json({ url: session.url, id: session.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "stripe_checkout_failed",
        message: "Stripe と の 通信 で 失敗 しました。 時間 を 置いて 再 試行 して ください。",
        detail: msg,
      },
      { status: 502 },
    );
  }
}
