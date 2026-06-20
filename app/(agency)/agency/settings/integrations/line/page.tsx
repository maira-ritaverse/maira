import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { LiffForm } from "./liff-form";
import { LineChannelForm } from "./line-channel-form";
import { LineChannelStatus } from "./line-channel-status";
import { RichMenuForm } from "./rich-menu-form";
import { SetupWizard } from "./setup-wizard";
import { WelcomeMessageForm } from "./welcome-message-form";

/**
 * /agency/settings/integrations/line
 *
 * エージェント 企業の LINE 公式アカウント 連携 設定 ページ。
 *
 * 手順 (UI 内 ガイド):
 *   1. LINE Developers コンソール で Messaging API チャネル 作成
 *   2. Channel ID / Channel Secret / Channel Access Token (長期) を 取得
 *   3. このページに 貼り付け → 自動 検証 + 保存
 *   4. Webhook URL を LINE 側 に 設定 (UI で コピー ボタン)
 *
 * admin 限定 (advisor は 閲覧のみ)。
 */
export default async function AgencyLineSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const isAdmin = role.member.role === "admin";
  const channel = await getMyLineChannel(supabase);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/agency/settings/integrations" className="hover:underline">
            ← 連携・アドオン
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">LINE 公式アカウント 連携</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          御社の LINE 公式アカウント を Maira と 連携 し、 求職者との やり取り を Maira UI で 完結
          させ ます。 求人共有 / Zoom 案内 / 一斉配信 などが LINE 経由 で 可能 に なります。
        </p>
      </div>

      {/* 未接続:ウィザード を 中心 に。 接続済:現状表示 + 詳細 設定 */}
      {!channel && isAdmin && <SetupWizard />}

      {!channel && !isAdmin && (
        <Card className="p-5">
          <p className="text-muted-foreground text-sm">
            未接続 です。 管理者 が 接続 する まで お待ち ください。
          </p>
        </Card>
      )}

      {channel && <LineChannelStatus channel={channel} />}

      {channel && isAdmin && <LineChannelForm initialChannel={channel} />}

      {channel && isAdmin && <WelcomeMessageForm />}
      {channel && isAdmin && <LiffForm organizationId={role.organization.id} />}
      {channel && isAdmin && <RichMenuForm />}
    </div>
  );
}
