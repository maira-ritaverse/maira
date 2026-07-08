import { redirect } from "next/navigation";

import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { rowToCustomFieldDefinition, type CustomFieldDefinition } from "@/lib/custom-fields/types";

import { CustomFieldsManager } from "./custom-fields-manager";

export default async function CustomFieldsPage() {
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
    .from("client_custom_field_definitions")
    .select("*")
    .eq("organization_id", role.organization.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  const fields: CustomFieldDefinition[] = (
    (data ?? []) as Parameters<typeof rowToCustomFieldDefinition>[0][]
  ).map(rowToCustomFieldDefinition);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SettingsBackLink href="/agency/settings" />
      <div>
        <h1 className="text-2xl font-bold">カスタムフィールド</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          組織独自の管理項目を顧客名簿に追加します(admin 専用)
        </p>
      </div>
      <CustomFieldsManager initialFields={fields} />
    </div>
  );
}
