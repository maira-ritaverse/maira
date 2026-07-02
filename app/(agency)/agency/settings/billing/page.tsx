import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { getBillingExemption } from "@/lib/billing/exemption";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { AiBoostToggle } from "./ai-boost-toggle";
import { BillingExemptCard } from "./billing-exempt-card";
import { PlanSelectForm } from "./plan-select-form";
import { PlanStatusCard } from "./plan-status-card";
import { SubscribedActionsCard } from "./subscribed-actions-card";
import { TestCardsNotice } from "./test-cards-notice";

/**
 * /agency/settings/billing
 *
 * 組織 admin 専用 の 課金 管理 ページ。 状態 に よって 表示 内容 を 分岐 する:
 *
 *   1. 免除 中 (is_billing_exempt=true)          → BillingExemptCard のみ
 *   2. 未 契約 (stripe_subscription_id=NULL)     → PlanSelectForm (Checkout 導線)
 *   3. トライアル 中 (status=trialing)           → PlanStatusCard + AiBoostToggle
 *                                                  + SubscribedActionsCard
 *                                                  (旧 TrialUpgradeChoiceForm は
 *                                                   Stripe 導入 後 は 実 効果 が 無く
 *                                                   旧価格 表示 の 景表法 リスク も ある
 *                                                   ため 廃止 済み)
 *   4. 契約 中 (active / past_due / 期末 解約 予約 中) → PlanStatusCard
 *                                                        + AiBoostToggle
 *                                                        + SubscribedActionsCard
 *   5. 解約 済 (canceled)                          → PlanStatusCard + PlanSelectForm
 *
 * 席 数 は organization_members の 実 メンバー 数 を そのまま 集計 (最低 3)。
 */
export const dynamic = "force-dynamic";

type PlanRow = {
  organization_id: string;
  tier: "standard" | "standard_rec" | "standard_pro" | "standard_premium";
  cycle: "monthly" | "yearly";
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  seat_count: number | null;
  ai_boost_enabled: boolean | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_upgrade_choice: "standard" | "standard_rec" | "standard_pro" | "standard_premium" | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billed_at: string | null;
  canceled_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export default async function AgencyBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }
  if (role.member.role !== "admin") {
    redirect("/agency/settings");
  }

  const organizationId = role.organization.id;

  // 免除 は アプリ 側 の 意思 決定 に 使う た め、 プラン 行 が 無くて も 先 に 引く
  const exemption = await getBillingExemption(organizationId);

  const { data: planRaw } = await supabase
    .from("organization_plans")
    .select(
      "organization_id, tier, cycle, status, seat_count, ai_boost_enabled, trial_started_at, trial_ends_at, trial_upgrade_choice, current_period_start, current_period_end, next_billed_at, canceled_at, stripe_customer_id, stripe_subscription_id",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  const plan = (planRaw ?? null) as PlanRow | null;

  const { count: memberCountRaw } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  const memberCount = memberCountRaw ?? 1;
  const seatCountForCheckout = Math.max(3, memberCount);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">課金 プラン</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          プラン 加入 / 変更 / 解約、 支払 情報 の 管理 を 行い ます。
        </p>
      </div>

      <TestCardsNotice />

      {exemption.isExempt ? (
        <BillingExemptCard reason={exemption.reason} setAt={exemption.setAt} />
      ) : !plan ? (
        // 通常 は 組織 作成 時 に 行 が 作られる が、 手動 で 消えた 等 の 保険
        <>
          <Card className="p-6">
            <Alert>
              <AlertDescription>
                プラン 情報 が 未 作成 です。 下 の フォーム から 新規 加入 して ください。
              </AlertDescription>
            </Alert>
          </Card>
          <PlanSelectForm currentSeatCount={seatCountForCheckout} />
        </>
      ) : !plan.stripe_subscription_id ? (
        // 未 契約: Checkout に 誘導
        <PlanSelectForm currentSeatCount={seatCountForCheckout} />
      ) : (
        <>
          <PlanStatusCard
            plan={{
              tier: plan.tier,
              cycle: plan.cycle,
              status: plan.status,
              seatCount: plan.seat_count ?? 3,
              aiBoostEnabled: Boolean(plan.ai_boost_enabled),
              trialEndsAt: plan.trial_ends_at,
              currentPeriodEnd: plan.current_period_end,
              canceledAt: plan.canceled_at,
            }}
          />

          {plan.status === "canceled" ? (
            <PlanSelectForm currentSeatCount={seatCountForCheckout} />
          ) : plan.status === "incomplete" ? (
            // 初回 決済 未 完了 (SCA 未 通過 / カード 拒否 等)。 この 状態 で は
            // Boost 追加 / 期末 解約 は Stripe が 400 を 返す。 Portal で 決済 を
            // 完了 させる 動線 だけ に 絞る。
            <Card className="p-6">
              <h2 className="text-base font-semibold">決済 が 完了 して い ません</h2>
              <p className="text-muted-foreground mt-2 text-xs">
                初回 の 決済 が 完了 して い ない ため、 プラン 変更 や 解約 は 行え ません。
                Billing Portal で カード 情報 を 再 登録 して 決済 を 完了 させて ください。
              </p>
              <div className="mt-4">
                <SubscribedActionsCard
                  pendingCancel={false}
                  status={plan.status}
                  currentPeriodEnd={plan.current_period_end}
                />
              </div>
            </Card>
          ) : (
            <>
              <AiBoostToggle enabled={Boolean(plan.ai_boost_enabled)} cycle={plan.cycle} />
              <SubscribedActionsCard
                pendingCancel={plan.canceled_at !== null}
                status={plan.status}
                currentPeriodEnd={plan.current_period_end}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
