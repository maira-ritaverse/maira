import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { getBillingExemption } from "@/lib/billing/exemption";
import { countOrganizationSeats, isCheckoutBlockedByStatus } from "@/lib/billing/org-checkout";
import {
  createOrgCheckoutSession,
  createSoloCheckoutSession,
  getOrgStripeConfig,
  isSoloTierValue,
  type OrgTier,
} from "@/lib/integrations/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/admin/organizations/[id]/checkout-link
 *
 * 運営者(Myaira admin)が、指定組織の Stripe Checkout リンクを発行する。
 * 発行したURLを顧客に送る(または開く)と、顧客が決済した時点で Stripe 側に
 * 「顧客 + サブスクリプション(metadata.organization_id / scope=organization 付き)」が
 * 自動作成され、Webhook 経由で organization_plans に自動同期される。
 *
 * これにより運営者は Stripe ダッシュボードで手動の顧客登録 / サブスク作成をする必要がない
 * (手動作成すると metadata が付かず、アプリが契約を認識できないズレの原因になる)。
 *
 * 対応 tier: standard / standard_pro(Team)+ solo / solo_pro(Solo)。
 * standard_rec / standard_premium は専用 Price が無いため対象外。
 *
 * Auth: profiles.is_maira_admin = true のみ。
 */
const bodySchema = z.object({
  tier: z.enum(["standard", "standard_pro", "solo", "solo_pro"]),
  cycle: z.enum(["monthly", "yearly"]),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // 1. 認証(運営者のみ)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isMairaAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 2. body 検証
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const tier = parsed.data.tier as OrgTier;
  const cycle = parsed.data.cycle;

  // 3. Stripe 設定
  const config = getOrgStripeConfig();
  if (!config) {
    return NextResponse.json(
      { error: "stripe_not_configured", message: "Stripe の設定がサーバ側に未登録です。" },
      { status: 503 },
    );
  }

  const admin = createServiceClient();

  // 4. 課金免除の組織には発行しない。免除組織は Webhook 側(handleCheckoutCompleted /
  //    handleSubscriptionSync / handleInvoicePaid)が同期をスキップするため、リンクで
  //    決済されても DB に一切残らず「実課金されているのにアプリ上は免除のまま」という
  //    追跡不能な不整合になる。self-serve 側と同じく発行前にブロックする。
  const exemption = await getBillingExemption(id);
  if (exemption.isExempt) {
    return NextResponse.json(
      {
        error: "billing_exempt",
        message:
          "この組織は課金免除に設定されています。決済リンクは発行できません(先に免除を解除してください)。",
      },
      { status: 409 },
    );
  }

  // 5. 既存プラン状態チェック(二重契約防止)。canceled / 未契約は発行可。
  const { data: existingPlan } = await admin
    .from("organization_plans")
    .select("status, stripe_customer_id")
    .eq("organization_id", id)
    .maybeSingle();
  const blocked = isCheckoutBlockedByStatus(existingPlan?.status);
  if (blocked.blocked) {
    const message =
      blocked.reason === "already_subscribed"
        ? "この組織は既に有効なプラン(トライアル含む)に加入済みです。プラン変更は tier 変更 / Portal から行ってください。"
        : blocked.reason === "past_due"
          ? "支払い失敗中です。まず Billing Portal で支払い方法を更新してください。"
          : "初回決済が未完了です。前回の Checkout URL を開いて完了させてください。";
    return NextResponse.json(
      { error: blocked.reason, message, currentStatus: existingPlan?.status },
      { status: 409 },
    );
  }

  // 6. 顧客メール(組織の admin メンバーの email を customer_email に使う)。
  //    複数 admin がいる場合は加入が最も古い admin を安定的に選ぶ(非決定を避ける)。
  const { data: adminMembers } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", id)
    .eq("role", "admin")
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(1);
  const adminUserId = (adminMembers?.[0] as { user_id: string } | undefined)?.user_id ?? null;
  let adminEmail: string | null = null;
  if (adminUserId) {
    const { data: userRes } = await admin.auth.admin.getUserById(adminUserId);
    adminEmail = userRes.user?.email ?? null;
  }
  if (!adminEmail) {
    return NextResponse.json(
      {
        error: "no_admin_email",
        message:
          "この組織に email 付きの管理者が見つかりません。先に管理者を招待してから発行してください。",
      },
      { status: 400 },
    );
  }

  // 7. Checkout Session 発行(Solo / Team で分岐)。冪等キーで再送時の二重発行を防ぐ。
  const idempotencyKey = `admin-checkout-link:${id}:${tier}:${cycle}:${Math.floor(Date.now() / 60000)}`;
  try {
    let url: string | null;
    if (isSoloTierValue(tier)) {
      const session = await createSoloCheckoutSession(config, {
        organizationId: id,
        tier,
        cycle,
        adminEmail,
        existingCustomerId: existingPlan?.stripe_customer_id ?? null,
        idempotencyKey,
      });
      url = session.url;
    } else {
      // Team 系は席数(最低 3)を集計して line_items を組み立てる。
      const seatCount = await countOrganizationSeats(admin, id);
      const session = await createOrgCheckoutSession(config, {
        organizationId: id,
        tier,
        cycle,
        seatCount,
        adminEmail,
        existingCustomerId: existingPlan?.stripe_customer_id ?? null,
        idempotencyKey,
      });
      url = session.url;
    }

    // 監査ログ失敗で「セッションは発行済みなのに 502」を返さないよう、非致命扱いにする。
    try {
      await recordAuditLog({
        userId: user.id,
        action: "subscription_changed",
        metadata: { organizationId: id, tier, cycle, via: "admin_checkout_link" },
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      });
    } catch (auditErr) {
      console.error("[admin/checkout-link] audit log failed (non-fatal)", {
        organizationId: id,
        message: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }

    return NextResponse.json({ url, tier, cycle, email: adminEmail });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/checkout-link] failed", {
      organizationId: id,
      tier,
      cycle,
      message: msg,
    });
    return NextResponse.json(
      {
        error: "stripe_checkout_failed",
        message: "Stripe Checkout リンクの発行に失敗しました。時間を置いて再度お試しください。",
        detail: msg,
      },
      { status: 502 },
    );
  }
}
