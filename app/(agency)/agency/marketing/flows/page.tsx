/**
 * /agency/marketing/flows
 *
 * Flow 一覧 画面。 Phase 1-E で 実装。
 * server component で 認可 + 初期 データ 取得、 詳細 は FlowList (client) へ。
 *
 * 認可 :
 *   ・organization_member ならば 閲覧 可
 *   ・admin のみ 有効化 トグル / 新規 作成 が 可能 (UI + API で 二重 防御)
 */
import { redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { listFlowsForOrg } from "@/lib/ma/flow-queries";
import { createClient } from "@/lib/supabase/server";
import { FlowList } from "./flow-list";

// 認証 ユーザー の 組織 単位 で 変動 する ため、 RSC キャッシュ を 無効化
export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // プラン tier で MA 機能 を ガード (Solo 系 は 使用 不可)。
  const plan = await getCurrentOrganizationPlan(supabase);
  const entitlements = getPlanEntitlements(plan?.tier ?? "standard");
  if (!entitlements.canUseMaFlows) {
    redirect("/agency");
  }

  const flows = await listFlowsForOrg(supabase, role.organization.id);

  return (
    <div className="space-y-6 p-6">
      <PageHeading
        title="Flow 一覧"
        description="Lステップ 相当 の 多段 シナリオ 配信。 プリセット から の 作成 と 有効化 トグル が 可能。"
      />
      <FlowList initialFlows={flows} isAdmin={role.member.role === "admin"} />
    </div>
  );
}
