import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listApplications } from "@/lib/applications/queries";
import {
  applicationStatuses,
  applicationStatusLabels,
  type ApplicationStatus,
} from "@/lib/applications/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 応募管理:一覧 + ステータスフィルタ
 *
 * status クエリパラメータでフィルタ。想定外の値はフィルタなしにフォールバック
 * (URL を手で書き換えられても落ちないように防御的)。
 */

type Props = {
  searchParams: Promise<{ status?: string }>;
};

export default async function ApplicationsListPage({ searchParams }: Props) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const statusFilter =
    params.status && (applicationStatuses as readonly string[]).includes(params.status)
      ? (params.status as ApplicationStatus)
      : undefined;

  const applications = await listApplications(user.id, statusFilter);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">応募管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">応募状況とタスクを一元管理します</p>
      </div>

      {/* ステータスフィルタ:横スクロール可能、選択中は primary 色で強調 */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/app/applications"
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            !statusFilter ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"
          }`}
        >
          すべて
        </Link>
        {applicationStatuses.map((s) => (
          <Link
            key={s}
            href={`/app/applications?status=${s}`}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"
            }`}
          >
            {applicationStatusLabels[s]}
          </Link>
        ))}
      </div>

      <div className="flex justify-end">
        <Button render={<Link href="/app/applications/new" />}>+ 新規応募を追加</Button>
      </div>

      {applications.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-lg">
            {statusFilter
              ? `「${applicationStatusLabels[statusFilter]}」の応募はまだありません`
              : "応募がまだ登録されていません"}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            「+ 新規応募を追加」ボタンから追加できます
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => (
            <Card key={app.id} className="p-0">
              <Link
                href={`/app/applications/${app.id}`}
                className="hover:bg-accent block p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{app.details.company}</p>
                      <span className="bg-muted rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                        {applicationStatusLabels[app.status]}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 truncate text-sm">
                      {app.details.position}
                    </p>
                    {app.next_action_at && (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                        次のアクション期限:
                        {new Date(app.next_action_at).toLocaleString("ja-JP")}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm">→</span>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
