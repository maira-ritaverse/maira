import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { rowToEmailTemplate, type EmailTemplate } from "@/lib/email-templates/templates";

import { EmailTemplatesManager } from "./email-templates-manager";

/**
 * メールテンプレ管理(admin 限定)
 *
 * 一覧 / 作成 / 編集 / 削除 を 1 画面で行う。
 * 利用は send-email-dialog / bulk-action-bar から「テンプレを選ぶ → 件名/本文を自動入力」。
 */
export default async function EmailTemplatesPage() {
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
    .from("email_templates")
    .select("*")
    .eq("organization_id", role.organization.id)
    .order("updated_at", { ascending: false });

  const templates: EmailTemplate[] = (
    (data ?? []) as Parameters<typeof rowToEmailTemplate>[0][]
  ).map(rowToEmailTemplate);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">メールテンプレート</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          メール送信ダイアログから呼び出せるテンプレを管理します(admin 専用)
        </p>
      </div>
      <EmailTemplatesManager initialTemplates={templates} />
    </div>
  );
}
