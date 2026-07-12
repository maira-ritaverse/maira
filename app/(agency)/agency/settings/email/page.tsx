/**
 * /agency/settings/email
 *
 * 各社が持ち込む Resend 設定(BYO)。 organization_admin のみ。
 * ・送信元アドレス(email_from)
 * ・Resend API キー(encrypted で保存、UI では平文を返さない)
 */
import { redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { OrgEmailSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function OrgEmailSettingsPage() {
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
    redirect("/agency/settings");
  }

  const { data } = await supabase
    .from("organizations")
    .select("email_from, resend_api_key_encrypted")
    .eq("id", role.organization.id)
    .maybeSingle();

  const row = data as {
    email_from: string | null;
    resend_api_key_encrypted: string | null;
  } | null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <PageHeading
        title="メール送信設定"
        description="メール Flow を自社ドメインから送るために、自社の Resend アカウントの API キーと送信元アドレスを登録します。"
      />

      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
        <div className="font-semibold">セットアップの流れ</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
          <li>
            <a
              href="https://resend.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Resend
            </a>
            にサインアップします。
          </li>
          <li>Resend の管理画面で自社ドメイン(例: abc-agency.co.jp)を追加します。</li>
          <li>
            Resend が指示する DNS レコード(SPF / DKIM / MX)を自社の DNS に設定し、Resend 側で verify
            します。
          </li>
          <li>Resend の「API Keys」で送信専用のキーを発行します(Sending access 権限)。</li>
          <li>
            下記フォームに送信元アドレス(例: recruit@abc-agency.co.jp)と API
            キーを入力して保存します。
          </li>
        </ol>
        <p className="text-muted-foreground mt-2 text-xs">
          未設定の場合、メール Flow は Maira の共通環境変数(RESEND_API_KEY /
          EMAIL_FROM)にフォールバックします。
        </p>
      </div>

      <OrgEmailSettingsForm
        initialEmailFrom={row?.email_from ?? ""}
        initialHasKey={Boolean(row?.resend_api_key_encrypted)}
      />
    </div>
  );
}
