/**
 * /agency/marketing/forms
 *
 * 組織のフォーム一覧。 admin は新規作成 / 削除 / 公開切替、 メンバーは閲覧のみ。
 */
import { redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { createClient } from "@/lib/supabase/server";

import { FormsScreen } from "./forms-screen";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
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
    .select("id, title, description, public_token, is_published, schema_json, updated_at")
    .eq("organization_id", role.organization.id)
    .order("updated_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeading
        title="フォーム"
        description="公式 LINE 追加後のヒアリングや、Web でのお問い合わせをフォームで受け付けます。送信されると、対応する Flow(trigger_type='フォーム送信時')が自動起動します。"
      />
      <FormsScreen initialForms={data ?? []} isAdmin={role.member.role === "admin"} />
    </div>
  );
}
