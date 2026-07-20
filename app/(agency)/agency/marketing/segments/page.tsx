/**
 * /agency/marketing/segments
 *
 * セグメント 一覧 + 選択中 セグメント の 編集。 Phase 1-G で 実装。
 * 認可 : organization member で 閲覧、 admin のみ 作成 / 編集 可能。
 */
import { redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { listOrganizationLineTags } from "@/lib/line/conversation-tags";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { listSegmentsForOrg } from "@/lib/ma/segment-queries";
import { createClient } from "@/lib/supabase/server";

import { SegmentsScreen } from "./segments-screen";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
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

  const [segments, tags] = await Promise.all([
    listSegmentsForOrg(supabase, role.organization.id),
    listOrganizationLineTags(role.organization.id),
  ]);

  return (
    <div className="space-y-6 p-6">
      <PageHeading
        title="セグメント 一覧"
        description="動的 条件 で 友だち を 絞り込む セグメント 定義。 Flow の 起動 対象 や Broadcast の 絞り込み に 使用。"
      />
      <SegmentsScreen
        initialSegments={segments}
        isAdmin={role.member.role === "admin"}
        tags={tags}
      />
    </div>
  );
}
