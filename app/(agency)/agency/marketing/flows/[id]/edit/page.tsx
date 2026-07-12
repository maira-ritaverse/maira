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

  const [flow, tags, templates, segments] = await Promise.all([
    getFlowDetail(supabase, role.organization.id, flowId),
    listOrganizationLineTags(role.organization.id),
    listMaTemplatesForOrg(supabase, role.organization.id),
    listSegmentsForOrg(supabase, role.organization.id),
  ]);
  if (!flow) notFound();

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col space-y-4 p-4">
      <PageHeading
        title={`Flow: ${flow.name}`}
        description={
          flow.description ??
          "ステップ を 追加 / 編集 して Flow を 構築 します。 変更 は 保存 ボタン で 反映。"
        }
      />
      <div className="flex-1 overflow-hidden">
        <FlowEditor
          flow={flow}
          isAdmin={role.member.role === "admin"}
          tags={tags}
          templates={templates}
          segments={segments}
        />
      </div>
    </div>
  );
}
