import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import {
  computePrice,
  getCurrentOrganizationPlan,
  isInTrial,
  PLAN_TIER_LABEL,
  PRICING,
  trialDaysRemaining,
} from "@/lib/billing/agency";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { TrialUpgradeChoiceForm } from "./trial-upgrade-choice-form";

/**
 * /agency/settings/billing
 *
 * エージェント企業 admin 専用の 課金プラン 管理 ページ。
 *
 * 表示内容:
 *   ・現プラン (Standard / 録音 / Pro / Premium)
 *   ・ステータス (trialing / active / canceled 等)
 *   ・無料期間 残日数
 *   ・料金内訳 (基本 + 4 人目以降 + アップグレード)
 *   ・トライアル中 のみ:アップグレード継続選択 フォーム
 *
 * Stripe 契約 後 に 追加 予定:
 *   ・プラン変更 / 解約 / 月払い⇔年払い切替 / Customer Portal
 *
 * /agency layout で 認証ガード済み。 ここでは admin role を 追加 チェック。
 */
export const dynamic = "force-dynamic";

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

  const plan = await getCurrentOrganizationPlan(supabase);

  // 組織 メンバー数 (4 人目以降 課金 用)
  const { count: memberCountRaw } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", role.organization.id);
  const memberCount = memberCountRaw ?? 1;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">課金プラン</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          現プラン / 無料期間の状況 / アップグレード選択
        </p>
      </div>

      {!plan ? (
        <Card className="p-6">
          <Alert>
            <AlertDescription>
              プラン情報が 未作成 です。 運営に お問い合わせ ください (maira-info@revorise.jp)。
            </AlertDescription>
          </Alert>
        </Card>
      ) : (
        <>
          <PlanStatusCard plan={plan} memberCount={memberCount} />

          {isInTrial(plan) ? (
            <TrialUpgradeChoiceForm
              initialChoice={plan.trialUpgradeChoice}
              trialEndsAt={plan.trialEndsAt ?? ""}
              memberCount={memberCount}
            />
          ) : (
            <Card className="p-6">
              <h2 className="text-sm font-semibold">プラン変更 / 解約</h2>
              <p className="text-muted-foreground mt-2 text-xs">
                Stripe 連携が 完了 次第、 ここから プラン変更 (排他 アップグレード) / 月払い ⇔
                年払い 切替 / 解約 が 可能 に なります。 現状は 運営側 で 手動 切替 対応 中 です
                (maira-info@revorise.jp までご連絡 ください)。
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PlanStatusCard({
  plan,
  memberCount,
}: {
  plan: Awaited<ReturnType<typeof getCurrentOrganizationPlan>>;
  memberCount: number;
}) {
  if (!plan) return null;
  const price = computePrice(plan.tier, memberCount, plan.cycle);
  const daysLeft = trialDaysRemaining(plan);
  const inTrial = isInTrial(plan);

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">現プラン</h2>

      <div className="mt-4 grid gap-3 text-sm">
        <Row label="プラン">{PLAN_TIER_LABEL[plan.tier]}</Row>
        <Row label="ステータス">
          <StatusBadge status={plan.status} />
        </Row>
        <Row label="課金サイクル">{plan.cycle === "monthly" ? "月払い" : "年払い (10% OFF)"}</Row>
        <Row label="メンバー数 (4 人目以降 課金)">
          {memberCount} 人 (うち 課金対象 {Math.max(0, memberCount - PRICING.includedSeats)} 人)
        </Row>

        {inTrial && (
          <Row label="無料期間 残日数">
            <span className="font-semibold text-emerald-700">{daysLeft} 日</span>
            {plan.trialEndsAt && (
              <span className="text-muted-foreground ml-2 text-xs">
                ({new Date(plan.trialEndsAt).toLocaleDateString("ja-JP")} 終了)
              </span>
            )}
          </Row>
        )}

        {!inTrial && plan.currentPeriodEnd && (
          <Row label="次回 課金日">
            {new Date(plan.currentPeriodEnd).toLocaleDateString("ja-JP")}
          </Row>
        )}
      </div>

      <hr className="my-4" />

      <h3 className="text-sm font-semibold">月額 内訳</h3>
      <div className="mt-3 space-y-2 text-sm">
        <PriceRow label="基本料金 (1〜3 人 含む)">¥{price.base.toLocaleString()}</PriceRow>
        {price.perSeatExtra > 0 && (
          <PriceRow
            label={`4 人目以降 (¥${PRICING.perSeatMonthly.toLocaleString()} × ${Math.max(0, memberCount - PRICING.includedSeats)} 人)`}
          >
            ¥{price.perSeatExtra.toLocaleString()}
          </PriceRow>
        )}
        {price.upgrade > 0 && (
          <PriceRow label={`アップグレード (${PLAN_TIER_LABEL[plan.tier]})`}>
            ¥{price.upgrade.toLocaleString()}
          </PriceRow>
        )}
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-sm font-semibold">月額 合計</span>
          <span className="text-base font-bold text-emerald-700">
            ¥{price.monthlyTotal.toLocaleString()}
          </span>
        </div>
        {plan.cycle === "monthly" && (
          <p className="text-muted-foreground text-xs">
            年払い に 切り替えると ¥{price.yearlyMonthlyEquivalent.toLocaleString()} / 月 相当 (10%
            OFF)
          </p>
        )}
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function PriceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    trialing: { label: "無料期間中", cls: "bg-emerald-100 text-emerald-800" },
    active: { label: "契約中", cls: "bg-blue-100 text-blue-800" },
    past_due: { label: "課金失敗", cls: "bg-amber-100 text-amber-800" },
    canceled: { label: "解約済", cls: "bg-slate-100 text-slate-700" },
    incomplete: { label: "未完了", cls: "bg-slate-100 text-slate-700" },
  };
  const m = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>
  );
}
