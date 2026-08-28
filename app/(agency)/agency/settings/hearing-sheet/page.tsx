import { redirect } from "next/navigation";

import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import {
  getHearingSheetTitle,
  listHearingSheetQuestions,
} from "@/lib/hearing-sheet-questions/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { HearingSheetManager } from "./hearing-sheet-manager";

/**
 * ヒアリングシート設定(admin 専用)
 *
 * ・シートのタイトル(組織別)
 * ・質問項目の増減 / リネーム / 並び順 / 本人情報マッピング(maps_to_pii)
 *
 * 質問定義は実在行のみを渡す(編集 / 削除に実 id が必要なため)。
 * 万一 0 件でもマネージャ側から追加できる(通常はマイグレーションで標準 11 項目が入る)。
 */
export default async function HearingSheetSettingsPage() {
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

  const [questions, title] = await Promise.all([
    listHearingSheetQuestions(role.organization.id),
    getHearingSheetTitle(role.organization.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SettingsBackLink href="/agency/settings" />
      <div>
        <h1 className="text-2xl font-bold">ヒアリングシート設定</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          ヒアリングシートのタイトルと質問項目を組織ごとに設定します(admin 専用)。
          質問に「本人情報マッピング」を設定すると、回答からクライアント履歴書の本人情報を埋められます。
        </p>
      </div>
      <HearingSheetManager initialTitle={title} initialQuestions={questions} />
    </div>
  );
}
