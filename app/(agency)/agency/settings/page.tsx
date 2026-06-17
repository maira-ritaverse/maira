import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { type NotificationPrefs } from "@/lib/notifications/prefs";

import { NotificationPrefsForm } from "./notification-prefs-form";

/**
 * 個人設定ページ
 *
 * 現状は「通知設定」のみ。将来「言語」「タイムゾーン」「ダッシュボード並び順」等を追加予定。
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const { data } = await supabase
    .from("organization_members")
    .select("notification_prefs")
    .eq("id", role.member.id)
    .maybeSingle();
  const prefs = ((data?.notification_prefs as NotificationPrefs | null) ?? {}) as NotificationPrefs;

  const isAdmin = role.member.role === "admin";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">個人設定</h1>
        <p className="text-muted-foreground mt-1 text-sm">通知の受け取り方を変更できます</p>
      </div>
      <NotificationPrefsForm initialPrefs={prefs} />

      {/* 外部連携(全メンバー) */}
      <Card className="p-4">
        <Link
          href="/agency/settings/integrations"
          className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">連携・アドオン</p>
            <p className="text-muted-foreground text-xs">
              Zoom / Google Meet 連携、会議録音アドオン、カレンダー購読 URL
            </p>
          </div>
          <span className="text-muted-foreground text-sm">→</span>
        </Link>
      </Card>

      {/* 推薦文テンプレート(全メンバー閲覧、admin 編集) */}
      <Card className="p-4">
        <Link
          href="/agency/settings/recommendation-letter-templates"
          className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">推薦文テンプレート</p>
            <p className="text-muted-foreground text-xs">
              求人企業に提出する推薦文の冒頭挨拶・末尾定型句を組織共通で管理
            </p>
          </div>
          <span className="text-muted-foreground text-sm">→</span>
        </Link>
      </Card>

      {isAdmin && (
        <Card className="p-4">
          <Link
            href="/agency/settings/ai-usage"
            className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">AI 利用状況(管理者向け)</p>
              <p className="text-muted-foreground text-xs">組織内の月次 AI 利用件数 + 概算コスト</p>
            </div>
            <span className="text-muted-foreground text-sm">→</span>
          </Link>
        </Card>
      )}
    </div>
  );
}
