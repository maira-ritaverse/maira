import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { getTemplateForScenario } from "@/lib/ma/queries";
import { TemplateEditor } from "./template-editor";

/**
 * テンプレート編集ページ
 *
 * /agency/marketing/[scenarioId]/template
 *
 * 流れ:
 *   1. organization_member ガード(layout で済んでいるが念のため)
 *   2. scenarioId からテンプレート + プリセット情報を取得(自組織分のみ)
 *   3. 見つからなければ 404
 *   4. TemplateEditor(クライアント)に渡す
 *
 * advisor も閲覧可能だが、保存ボタンは isAdmin=false で disable する。
 */
export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;

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

  const template = await getTemplateForScenario(role.organization.id, scenarioId);
  if (!template) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <TemplateEditor template={template} isAdmin={role.member.role === "admin"} />
    </div>
  );
}
