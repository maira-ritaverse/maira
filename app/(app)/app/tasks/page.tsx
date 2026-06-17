import { ListChecks } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listAllTasks } from "@/lib/tasks/queries";
import { listApplications } from "@/lib/applications/queries";
import { taskPriorityLabels, type Task } from "@/lib/tasks/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * 横断タスクビュー(/app/tasks)。
 *
 * 各応募詳細画面の中にも個別のタスク一覧はあるが、ここでは応募をまたいで
 * 「いま全体で何が期限間近か」を把握できるようにする。
 *
 * 期限別に 5 セクションに分類し、視覚的に重要度が分かる配色で表示する。
 */
export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [tasks, applications] = await Promise.all([
    listAllTasks(user.id),
    listApplications(user.id),
  ]);

  // 応募ID → 企業名のマップ。タスクから紐づく応募の表示用に作る。
  // 応募が削除されている場合(orphan task)は appMap.get で undefined になり、
  // 表示側で「📋 ○○社」行を出さないことで対処する。
  const appMap = new Map<string, string>();
  for (const app of applications) {
    appMap.set(app.id, app.details.company);
  }

  // 期限別に分類。queries.ts のロジックと同じ基準だが、ここは「期限なし」を
  // 独立したセクションとして表示するので別実装にしている。
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const sections = {
    overdue: [] as Task[],
    today: [] as Task[],
    thisWeek: [] as Task[],
    upcoming: [] as Task[],
    noDate: [] as Task[],
  };

  for (const task of tasks) {
    if (!task.due_at) {
      sections.noDate.push(task);
      continue;
    }
    const due = new Date(task.due_at);
    if (due < now) sections.overdue.push(task);
    else if (due <= todayEnd) sections.today.push(task);
    else if (due <= weekEnd) sections.thisWeek.push(task);
    else sections.upcoming.push(task);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">タスク</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            応募活動に紐づくすべてのタスクを横断表示します
          </p>
        </div>
        <Button render={<Link href="/app" />} variant="outline" size="sm">
          ダッシュボードへ
        </Button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-10 w-10" />}
          title="タスクはありません"
          description="応募詳細画面でタスクを追加できます"
        />
      ) : (
        <>
          <TaskSection
            title="期限超過"
            tasks={sections.overdue}
            appMap={appMap}
            variant="overdue"
          />
          <TaskSection title="本日中" tasks={sections.today} appMap={appMap} variant="today" />
          <TaskSection title="今週中" tasks={sections.thisWeek} appMap={appMap} variant="week" />
          <TaskSection
            title="それ以降"
            tasks={sections.upcoming}
            appMap={appMap}
            variant="upcoming"
          />
          <TaskSection
            title="期限なし"
            tasks={sections.noDate}
            appMap={appMap}
            variant="upcoming"
          />
        </>
      )}
    </div>
  );
}

type SectionVariant = "overdue" | "today" | "week" | "upcoming";

function TaskSection({
  title,
  tasks,
  appMap,
  variant,
}: {
  title: string;
  tasks: Task[];
  appMap: Map<string, string>;
  variant: SectionVariant;
}) {
  // セクションに 1 件もないときは見出しごと省略(縦のスペース節約)
  if (tasks.length === 0) return null;

  const variantClasses: Record<SectionVariant, string> = {
    overdue: "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30",
    today: "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30",
    week: "border-primary/40 bg-primary/5",
    upcoming: "",
  };

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold">
        {title} <span className="text-muted-foreground text-sm font-normal">({tasks.length})</span>
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => {
          const companyName = task.application_id ? appMap.get(task.application_id) : undefined;
          return (
            <Card key={task.id} className={`p-4 ${variantClasses[variant]}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{task.title}</p>
                  <div className="text-muted-foreground mt-1 flex flex-wrap gap-2 text-xs">
                    {companyName && <span>{companyName}</span>}
                    {task.due_at && (
                      <span>期限:{new Date(task.due_at).toLocaleString("ja-JP")}</span>
                    )}
                    {task.priority > 0 && <span>優先度:{taskPriorityLabels[task.priority]}</span>}
                  </div>
                </div>
                {task.application_id && (
                  <Button
                    render={<Link href={`/app/applications/${task.application_id}`} />}
                    variant="outline"
                    size="sm"
                  >
                    応募へ
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
