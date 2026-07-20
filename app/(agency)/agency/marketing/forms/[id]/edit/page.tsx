/**
 * /agency/marketing/forms/[id]/edit
 *
 * フォームビルダー。 質問を追加 / 並び替え / 種別変更 / 公開切替。
 */
import { notFound, redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { createClient } from "@/lib/supabase/server";

import { FormBuilder } from "./form-builder";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

export default async function FormEditPage({ params }: { params: RouteParams }) {
  const { id: formId } = await params;

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

  const { data } = await supabase
    .from("forms")
    .select("id, title, description, public_token, is_published, schema_json")
    .eq("id", formId)
    .eq("organization_id", role.organization.id)
    .maybeSingle();
  if (!data) notFound();

  const { count: submissionCount } = await supabase
    .from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeading
        title={`フォーム: ${data.title}`}
        description="質問を追加・並び替えて公開してください。回答は暗号化して保存されます。"
      />
      <FormBuilder
        formId={data.id}
        initialTitle={data.title}
        initialDescription={data.description ?? ""}
        initialSchema={data.schema_json ?? []}
        initialPublished={data.is_published}
        publicToken={data.public_token}
        submissionCount={submissionCount ?? 0}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
