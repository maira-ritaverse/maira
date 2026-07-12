import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
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
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeading title="個人設定" description="通知の受け取り方や各種連携を変更できます" />

      {/*
        2 カラム レイアウト:
          ・左: 通知設定 (頻繁 に 触る ため 一番 目立つ 位置)
          ・右: その他 の 設定 (連携 / テンプレート / 管理者 向け)
        md 未満 は 1 カラム に 折り返す。
      */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* 左: 通知設定 のみ */}
        <div>
          <NotificationPrefsForm initialPrefs={prefs} />
        </div>

        {/* 右: その他 を まとめて */}
        <div className="space-y-3">
          {/* プロフィール 編集 (表示名 + アバター) */}
          <Card className="p-4">
            <Link
              href="/agency/settings/profile"
              className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">プロフィール</p>
                <p className="text-muted-foreground text-xs">
                  表示名 と アイコン 画像 (管理者 が 一覧 で 識別 し やすく する)
                </p>
              </div>
              <span className="text-muted-foreground text-sm">→</span>
            </Link>
          </Card>

          {/* LINE 自己紹介 */}
          <Card className="p-4">
            <Link
              href="/agency/settings/line-intro"
              className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">LINE 自己紹介</p>
                <p className="text-muted-foreground text-xs">
                  顧客への LINE で 送る 顔写真 + プロフィール + エージェントとしての思い
                </p>
              </div>
              <span className="text-muted-foreground text-sm">→</span>
            </Link>
          </Card>

          {/* パスワード 変更 */}
          <Card className="p-4">
            <Link
              href="/agency/settings/password"
              className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">パスワード変更</p>
                <p className="text-muted-foreground text-xs">ログイン パスワード を 変更 します</p>
              </div>
              <span className="text-muted-foreground text-sm">→</span>
            </Link>
          </Card>

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
                href="/agency/settings/teams"
                className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">リスト表管理(管理者向け)</p>
                  <p className="text-muted-foreground text-xs">
                    組織内のリスト表を作成し、顧客リストをチーム別に分離。大規模エージェント向け
                  </p>
                </div>
                <span className="text-muted-foreground text-sm">→</span>
              </Link>
            </Card>
          )}

          {isAdmin && (
            <Card className="p-4">
              <Link
                href="/agency/admin/overview"
                className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">組織の全体像(管理者向け)</p>
                  <p className="text-muted-foreground text-xs">
                    組織 → リスト表 → メンバー の階層と顧客の割当状況をツリーで可視化
                  </p>
                </div>
                <span className="text-muted-foreground text-sm">→</span>
              </Link>
            </Card>
          )}

          {isAdmin && (
            <Card className="p-4">
              <Link
                href="/agency/settings/ai-usage"
                className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">AI 利用状況(管理者向け)</p>
                  <p className="text-muted-foreground text-xs">
                    組織内の月次 AI 利用件数 + 概算コスト
                  </p>
                </div>
                <span className="text-muted-foreground text-sm">→</span>
              </Link>
            </Card>
          )}

          {isAdmin && (
            <Card className="p-4">
              <Link
                href="/agency/settings/billing"
                className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">課金プラン(管理者向け)</p>
                  <p className="text-muted-foreground text-xs">
                    現プラン / 無料期間の残日数 / アップグレード選択
                  </p>
                </div>
                <span className="text-muted-foreground text-sm">→</span>
              </Link>
            </Card>
          )}

          {isAdmin && (
            <Card className="p-4">
              <Link
                href="/agency/settings/email"
                className="hover:bg-accent -m-4 flex items-center gap-3 rounded-md p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">メール送信設定(管理者向け)</p>
                  <p className="text-muted-foreground text-xs">
                    自社ドメイン + Resend API キーを登録して、メール Flow を自社ドメインから送信
                  </p>
                </div>
                <span className="text-muted-foreground text-sm">→</span>
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
