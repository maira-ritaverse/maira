import { redirect } from "next/navigation";

import { getUserRole } from "@/lib/organizations/queries";
import { listTemplates } from "@/lib/recommendation-letters/queries";
import { createClient } from "@/lib/supabase/server";

import { RecommendationLetterTemplatesManager } from "./templates-manager";

/**
 * 推薦文テンプレートの管理画面(組織共通、admin 編集可)
 *
 * 「冒頭挨拶」「末尾の組織連絡先」のような定型句を組織で 1 つ以上用意し、
 * 推薦文編集画面で選択できるようにする。
 * UI / API は email-templates と同じ admin-only 編集パターン。
 */
export default async function RecommendationLetterTemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const templates = await listTemplates(role.organization.id);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 lg:px-6">
      <div>
        <h1 className="text-2xl font-bold">推薦文テンプレート</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          推薦文(求人企業への提出書)の冒頭挨拶や末尾の組織連絡先など、定型句を組織で共通管理します。
          編集 / 削除 / 作成は管理者のみ。一般メンバーは閲覧と推薦文編集時の選択ができます。
        </p>
      </div>

      <RecommendationLetterTemplatesManager
        initialTemplates={templates}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
