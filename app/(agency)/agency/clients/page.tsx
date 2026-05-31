import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listClientRecords } from "@/lib/clients/queries";
import { clientStatusLabels, clientLinkStatusLabels } from "@/lib/clients/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * クライアント一覧画面
 *
 * layout.tsx でロールガード済みだが、organization 取り出しのため再度 getUserRole を呼ぶ。
 * listClientRecords は RLS により自社のクライアントのみ返す。
 */
export default async function ClientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const clients = await listClientRecords(role.organization.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">クライアント管理</h1>
          <p className="text-muted-foreground mt-1 text-sm">担当する求職者を管理します</p>
        </div>
        <Button render={<Link href="/agency/clients/new" />}>+ クライアント登録</Button>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          icon="👥"
          title="クライアントがまだ登録されていません"
          description="「クライアント登録」ボタンから追加できます"
        />
      ) : (
        <div className="space-y-2">
          {clients.map((client) => (
            <Card key={client.id} className="p-0">
              <Link
                href={`/agency/clients/${client.id}`}
                className="hover:bg-accent flex items-center justify-between gap-4 p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{client.name}</p>
                  <p className="text-muted-foreground truncate text-sm">{client.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
