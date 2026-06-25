/**
 * /agency/management
 *
 * 管理者 ( admin ) 向け の 「組織 マネジメント ダッシュボード」。
 * 組織 全体 を 1 画面 で 把握 する。
 *
 * 表示:
 *   1. KPI カード ( 求職者 / 求人 / 未 割り当て / 沈黙 / 期限 切れ タスク )
 *   2. アドバイザー 別 サマリー ( 担当 数 / 副 担当 数 / 沈黙 / 期限 切れ )
 *   3. 未 割り当て クライアント 一覧 ( 直近 20 件、 担当 を 付ける 動線 )
 *
 * アクセス: organization_members.role = 'admin' のみ。 advisor は /agency にリダイレクト。
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Briefcase, ClockAlert, UserCog, UserX, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getManagementSummary } from "@/lib/management/queries";

export default async function ManagementPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }
  if (role.member.role !== "admin") {
    redirect("/agency");
  }

  const summary = await getManagementSummary(role.organization.id);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">組織マネジメント</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          組織全体の状況を1画面で把握できます。管理者専用です。
        </p>
      </div>

      {/* KPI カード */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          icon={Users}
          label="求職者"
          value={summary.totalClients.toLocaleString()}
          tone="default"
        />
        <KpiCard
          icon={Briefcase}
          label="掲載中の求人"
          value={summary.totalOpenJobs.toLocaleString()}
          tone="default"
        />
        <KpiCard
          icon={UserX}
          label="未割り当て"
          value={summary.unassignedCount.toLocaleString()}
          tone={summary.unassignedCount > 0 ? "warn" : "default"}
        />
        <KpiCard
          icon={AlertTriangle}
          label="沈黙(30日+)"
          value={summary.silentCountTotal.toLocaleString()}
          tone={summary.silentCountTotal > 0 ? "warn" : "default"}
        />
        <KpiCard
          icon={ClockAlert}
          label="期限切れタスク"
          value={summary.overdueTaskTotal.toLocaleString()}
          tone={summary.overdueTaskTotal > 0 ? "danger" : "default"}
        />
      </div>

      {/* アドバイザー別サマリー */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-base font-bold">アドバイザー別サマリー</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            担当数が多い順。沈黙・期限切れの件数で異常を即座に検知。
          </p>
        </div>
        {summary.advisors.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            アドバイザーが登録されていません。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">アドバイザー</th>
                  <th className="px-4 py-3 text-right font-medium">主担当</th>
                  <th className="px-4 py-3 text-right font-medium">副担当</th>
                  <th className="px-4 py-3 text-right font-medium">沈黙</th>
                  <th className="px-4 py-3 text-right font-medium">期限切れ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.advisors.map((a) => (
                  <tr key={a.memberId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {a.displayName ?? "(名前未設定)"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.assignedCount}</td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                      {a.collaboratorCount}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        a.silentCount > 0 ? "font-bold text-amber-600" : "text-slate-500"
                      }`}
                    >
                      {a.silentCount}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        a.overdueTaskCount > 0 ? "font-bold text-red-600" : "text-slate-500"
                      }`}
                    >
                      {a.overdueTaskCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 未割り当てクライアント */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold">
              <UserCog className="size-4 text-amber-500" />
              未割り当てクライアント
              <span className="text-muted-foreground text-xs font-normal">
                ({summary.unassignedClients.length}件 / 全{summary.unassignedCount}件)
              </span>
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              担当アドバイザーがいない求職者。早めに割り当てて対応漏れを防ぎましょう。
            </p>
          </div>
          {summary.unassignedCount > 0 && (
            <Button size="sm" variant="outline" render={<Link href="/agency/clients" />}>
              クライアント一覧で割り当て
            </Button>
          )}
        </div>
        {summary.unassignedClients.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            未割り当てのクライアントはありません。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {summary.unassignedClients.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <Link
                    href={`/agency/clients/${c.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {c.status} · 登録 {formatDate(c.createdAt)}
                  </p>
                </div>
                <Link
                  href={`/agency/clients/${c.id}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  開く →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone: "default" | "warn" | "danger";
}) {
  const palette =
    tone === "danger"
      ? "border-red-200 bg-red-50/40"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/40"
        : "border-slate-200";
  const iconColor =
    tone === "danger" ? "text-red-500" : tone === "warn" ? "text-amber-500" : "text-slate-500";
  const valueColor =
    tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";

  return (
    <Card className={`p-4 ${palette}`}>
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${iconColor}`} />
        <p className="text-xs text-slate-600">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
    </Card>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
