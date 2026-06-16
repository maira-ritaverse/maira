import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listApplications } from "@/lib/applications/queries";
import { createClient } from "@/lib/supabase/server";

import { ApplicationsListClient } from "./applications-list-client";

/**
 * 応募管理:一覧 + 検索 / フィルタ / 期限サマリ(クライアント側)
 *
 * 現状の規模では全件を読み込んで JS でフィルタ・ソートしている(顧客一覧と同パターン)。
 * 100 件超になったらサーバ側ページネーションに切り替える前提。
 */
export default async function ApplicationsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const applications = await listApplications(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">応募管理</h1>
          <p className="text-muted-foreground mt-1 text-sm">応募状況とタスクを一元管理します</p>
        </div>
        <Button render={<Link href="/app/applications/new" />}>+ 新規応募を追加</Button>
      </div>

      {applications.length === 0 ? (
        <EmptyState
          icon="📋"
          title="応募がまだ登録されていません"
          description="「+ 新規応募を追加」ボタンから追加できます"
        />
      ) : (
        <ApplicationsListClient applications={applications} />
      )}
    </div>
  );
}
