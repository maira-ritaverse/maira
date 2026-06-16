import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { rowToIntakeForm, type IntakeForm } from "@/lib/intake-forms/types";

import { IntakeFormsManager } from "./intake-forms-manager";

/**
 * 顧客向け埋め込みフォーム管理(admin 限定)
 *
 * - 一覧 / 作成 / 編集(active 切替 / entry_site / 名前)/ 削除
 * - 公開 URL のコピー(NEXT_PUBLIC_SITE_URL を基準)
 */
export default async function IntakeFormsPage() {
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
    redirect("/agency");
  }

  const { data } = await supabase
    .from("intake_forms")
    .select("*")
    .eq("organization_id", role.organization.id)
    .order("created_at", { ascending: false });

  const forms: IntakeForm[] = ((data ?? []) as Parameters<typeof rowToIntakeForm>[0][]).map(
    rowToIntakeForm,
  );
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">埋め込みフォーム</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          顧客からの問い合わせ受付用 URL を発行します(admin 専用)
        </p>
      </div>
      <IntakeFormsManager initialForms={forms} siteUrl={siteUrl} />
    </div>
  );
}
