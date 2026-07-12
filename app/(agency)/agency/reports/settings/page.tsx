/**
 * /agency/reports/settings
 *
 * admin 限定:月次目標 + 月次コスト の入力画面。
 * 直近 12 か月分を表形式で編集できる。
 */
import { redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { ReportSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ReportSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    redirect("/agency/reports");
  }

  const [{ data: targets }, { data: costs }] = await Promise.all([
    supabase
      .from("report_targets")
      .select(
        "year_month, placement_count_target, net_revenue_target, application_count_target, interview_count_target",
      )
      .eq("organization_id", role.organization.id)
      .order("year_month", { ascending: false })
      .limit(24),
    supabase
      .from("report_costs")
      .select("year_month, marketing_cost, tool_cost, personnel_cost, other_cost, memo")
      .eq("organization_id", role.organization.id)
      .order("year_month", { ascending: false })
      .limit(24),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <SettingsBackLink href="/agency/reports" />
      <PageHeading
        title="レポート設定(目標 + コスト)"
        description="月次目標(達成率の基準)と、月次コスト(ROI の投資額)を管理者が入力します。 未入力の月はレポート側で該当セクションが自動的に隠れます。"
      />
      <ReportSettingsForm initialTargets={targets ?? []} initialCosts={costs ?? []} />
    </div>
  );
}
