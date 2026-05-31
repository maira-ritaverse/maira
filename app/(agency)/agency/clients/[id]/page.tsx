import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { clientStatusLabels, clientLinkStatusLabels } from "@/lib/clients/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDetailForm } from "./client-detail-form";

/**
 * クライアント詳細画面
 *
 * RLS で自社のレコードしか取れないはずだが、念のため organizationId 一致を
 * 明示確認してから notFound() に倒す(他社の id を踏んだときの 404 担保)。
 */

type RouteParams = { params: Promise<{ id: string }> };

export default async function ClientDetailPage({ params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const client = await getClientRecord(id);
  if (!client || client.organizationId !== role.organization.id) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
              {clientStatusLabels[client.status]}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                client.linkStatus === "linked"
                  ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {clientLinkStatusLabels[client.linkStatus]}
            </span>
          </div>
        </div>
        <Button render={<Link href="/agency/clients" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      {/* 連携状態に応じた案内カード */}
      {client.linkStatus === "unlinked" && (
        <Card className="border-muted-foreground/20 bg-muted/30 p-4">
          <p className="text-sm">
            このクライアントはまだMairaアカウントと連携していません。 求職者が{" "}
            <span className="font-medium">{client.email}</span> でMairaに登録し、
            連携を承諾すると、共有された書類などを閲覧できるようになります。
          </p>
        </Card>
      )}
      {client.linkStatus === "invited" && (
        <Card className="bg-muted/30 p-4">
          <p className="text-sm">連携招待を送信済みです。求職者の承諾を待っています。</p>
        </Card>
      )}
      {client.linkStatus === "linked" && (
        <Card className="border-green-200 bg-green-50/50 p-4 dark:border-green-900 dark:bg-green-950/30">
          <p className="text-sm">
            このクライアントはMairaアカウントと連携済みです。
            求職者が共有を許可した書類を閲覧できます(書類閲覧機能は今後追加予定)。
          </p>
        </Card>
      )}
      {client.linkStatus === "revoked" && (
        <Card className="bg-muted/30 p-4">
          <p className="text-sm">
            連携が解除されています。求職者が再度承諾するまで共有書類は閲覧できません。
          </p>
        </Card>
      )}

      <ClientDetailForm client={client} />
    </div>
  );
}
