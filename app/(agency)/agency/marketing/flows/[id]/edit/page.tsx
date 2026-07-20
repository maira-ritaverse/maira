/**
 * /agency/marketing/flows/[id]/edit
 *
 * Flow ビルダー 画面。 Phase 1-F で 実装。
 * ReactFlow ベース の ノード エディタ で ステップ を 追加 / 編集 / 並び替え。
 */
import { notFound, redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { listOrganizationLineTags } from "@/lib/line/conversation-tags";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { listFlowAuditByFlow } from "@/lib/ma/flow-audit";
import { getFlowAttribution } from "@/lib/ma/flow-attribution";
import { getFlowDetail, listMaTemplatesForOrg } from "@/lib/ma/flow-queries";
import { listSegmentsForOrg } from "@/lib/ma/segment-queries";
import { createClient } from "@/lib/supabase/server";

import { FlowEditor } from "./flow-editor";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

export default async function FlowEditPage({ params }: { params: RouteParams }) {
  const { id: flowId } = await params;

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

  const [flow, tags, templates, segments, attribution, auditLog] = await Promise.all([
    getFlowDetail(supabase, role.organization.id, flowId),
    listOrganizationLineTags(role.organization.id),
    listMaTemplatesForOrg(supabase, role.organization.id),
    listSegmentsForOrg(supabase, role.organization.id),
    getFlowAttribution(supabase, role.organization.id, flowId),
    listFlowAuditByFlow(supabase, role.organization.id, flowId, 20),
  ]);
  if (!flow) notFound();

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col space-y-4 p-4">
      <PageHeading
        title={`Flow: ${flow.name}`}
        description={
          flow.description ?? "ステップを追加・編集して Flow を構築します。変更は保存ボタンで反映。"
        }
      />
      <div className="flex-1 overflow-hidden">
        <FlowEditor
          flow={flow}
          isAdmin={role.member.role === "admin"}
          tags={tags}
          templates={templates}
          segments={segments}
          attribution={attribution}
          auditLog={auditLog}
        />
      </div>
    </div>
  );
}
