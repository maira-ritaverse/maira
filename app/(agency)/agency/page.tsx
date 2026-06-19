import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionLayoutContainer } from "@/components/features/layout/section-layout-container";

import { AnnouncementsSection } from "./announcements-section";
import { getOrgAiTotalQuotaSummary } from "@/lib/agency/ai-usage-queries";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import {
  getClientRecordsTotalCount,
  listClientRecordsWithUpdateBadge,
} from "@/lib/clients/queries";
import { findDuplicateClientGroups } from "@/lib/clients/duplicates";
import {
  DATA_QUALITY_FIELD_LABEL,
  evaluateDataQuality,
  type DataQualityField,
} from "@/lib/clients/data-quality";

import { NextMeetingWidget } from "@/components/features/meetings/next-meeting-widget";
import { getNextMeetingForHost } from "@/lib/meetings/queries";

import { MyTasksWidget } from "./my-tasks-widget";

/**
 * /agency ダッシュボード(ランディング)
 *
 * サイドバーの「クライアント管理」「カレンダー」「レポート」等の前面に置く
 * 集約ビュー。組織で「今やるべきこと」「最近の活動」「アラート」を 1 画面で把握する。
 *
 * データ源:
 *   - listClientRecordsWithUpdateBadge:既存のリッチ取得を再利用(沈黙 / 重複の集計)
 *   - agency_tasks(自分宛、未完了)
 *   - client_interactions(全件、直近 N 件)
 *
 * パフォーマンス:
 *   - clients は全件取得 → JS で集計(現状の規模感に合わせる)。
 *     ページネーション導入後はサーバー側集計 RPC に切り替える前提。
 */
export default async function AgencyDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const orgId = role.organization.id;
  const memberId = role.member.id;

  // 並列取得:クライアント / 自分のタスク / 直近の対応履歴 / 総件数 / 次の面談 / AI 残数
  const [clients, myTasksRes, recentInteractionsRes, totalClientCount, nextMeeting, aiTotalQuota] =
    await Promise.all([
      listClientRecordsWithUpdateBadge(orgId, user.id),
      supabase
        .from("agency_tasks")
        .select("id, title, due_at, priority, client_record_id")
        .eq("organization_id", orgId)
        .eq("assigned_member_id", memberId)
        .eq("status", "pending")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(8),
      supabase
        .from("client_interactions")
        .select("id, interaction_type, occurred_at, summary, client_record_id")
        .eq("organization_id", orgId)
        .order("occurred_at", { ascending: false })
        .limit(6),
      getClientRecordsTotalCount(orgId),
      getNextMeetingForHost(supabase, user.id, { withinHours: 24 }),
      getOrgAiTotalQuotaSummary(),
    ]);

  // ────────────────────────────────────────────
  // 集計:沈黙 / 重複 / アクティブ状況
  //
  // サーバー時刻ベースで集計する(クライアント側のタイムゾーン違いを吸収)。
  // Date.now() は react-hooks/purity で warn されるため new Date().getTime() を使う。
  // ────────────────────────────────────────────
  const now = new Date().getTime();
  const DAY = 24 * 60 * 60 * 1000;
  let silent30 = 0;
  let silent60 = 0;
  let neverContacted = 0;
  let totalActive = 0;
  for (const c of clients) {
    if (c.status === "completed" || c.status === "declined") continue;
    totalActive += 1;
    if (c.lastInteractionAt === null) neverContacted += 1;
    const baseIso = c.lastInteractionAt ?? c.createdAt;
    const baseMs = Date.parse(baseIso);
    if (Number.isNaN(baseMs)) continue;
    const elapsed = now - baseMs;
    if (elapsed >= 30 * DAY) silent30 += 1;
    if (elapsed >= 60 * DAY) silent60 += 1;
  }
  const duplicates = findDuplicateClientGroups(clients);

  // データ品質サマリ(評価対象は active な顧客のみ:完了 / 見送り 除外)
  const dataQuality = evaluateDataQuality(clients);
  const completionRate =
    dataQuality.evaluatedCount === 0
      ? 100
      : Math.round((dataQuality.completeCount / dataQuality.evaluatedCount) * 100);
  // 未入力件数の多い順に並べる
  const sortedQualityFields = (Object.keys(dataQuality.missingByField) as DataQualityField[])
    .map((f) => ({ field: f, count: dataQuality.missingByField[f] }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  // クライアント名 Map(タスク / 対応履歴の表示用)
  const clientNameMap = new Map<string, string>(clients.map((c) => [c.id, c.name]));

  // 自分のタスク(行)
  type MyTaskRow = {
    id: string;
    title: string;
    due_at: string | null;
    priority: string | null;
    client_record_id: string;
  };
  const myTasks = (myTasksRes.data ?? []) as MyTaskRow[];

  // 直近対応履歴
  type RecentInteractionRow = {
    id: string;
    interaction_type: string;
    occurred_at: string;
    summary: string | null;
    client_record_id: string;
  };
  const recentInteractions = (recentInteractionsRes.data ?? []) as RecentInteractionRow[];

  return (
    // ダッシュボードはウィジェット並べ替え + 2 列対応のため max-w-7xl の広めに。
    // モバイルは px-4 / デスクトップは lg:px-6 でコンテンツ余白を保つ。
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-bold">ダッシュボード</h1>
        <p className="text-muted-foreground mt-1 text-sm">{role.organization.name} の今の状態</p>
      </div>

      {/* 次の面談(24h 以内に予定があるときだけ表示) */}
      <NextMeetingWidget initial={nextMeeting} />

      {/* 規模アラート(コンテナの外に出しておく:常に最上部で目立たせたいため) */}
      {totalClientCount !== null && totalClientCount > 1000 && (
        <Card className="border-amber-200 bg-amber-50/50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
          登録顧客が {totalClientCount.toLocaleString()} 件に達しました。
          一覧の読み込みが遅くなる場合は、サーバーページネーションへの切替を検討してください。
        </Card>
      )}

      {/* AI 月次残数(運営側 設定の 強制上限、変更不可) */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="space-y-1">
          <p className="text-muted-foreground text-[10px]">今月の AI 利用可能 残数 (組織全体)</p>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold">{aiTotalQuota.remaining.toLocaleString()}</span>
            <span className="text-muted-foreground text-xs">
              / {aiTotalQuota.limit.toLocaleString()} 回(使用済み{" "}
              {aiTotalQuota.current.toLocaleString()})
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full transition-all ${
                aiTotalQuota.remaining === 0
                  ? "bg-red-500"
                  : aiTotalQuota.remaining < aiTotalQuota.limit * 0.1
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{
                width: `${
                  aiTotalQuota.limit > 0
                    ? Math.min(100, (aiTotalQuota.current / aiTotalQuota.limit) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          {role.member.role === "admin" && (
            <Link
              href="/agency/settings/ai-usage"
              className="text-muted-foreground text-[10px] hover:underline"
            >
              詳細を見る →
            </Link>
          )}
        </div>
      </Card>

      <SectionLayoutContainer
        storageKey="agency-dashboard"
        defaultOrder={[
          "platform-announcements",
          "kpi",
          "my-tasks",
          "recent-interactions",
          "data-quality",
          "duplicates",
          "quick-actions",
        ]}
        titles={{
          "platform-announcements": "Maira からのお知らせ",
          kpi: "活動概要(KPI)",
          "my-tasks": "自分のタスク",
          "recent-interactions": "直近の対応履歴",
          "data-quality": "データ入力品質",
          duplicates: "重複候補",
          "quick-actions": "クイックアクション",
        }}
        sections={{
          "platform-announcements": <AnnouncementsSection />,
          kpi: (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="活動中の顧客" value={totalActive} hint="完了 / 見送り は除外" />
              <StatCard
                label="30日以上対応なし"
                value={silent30}
                tone={silent30 > 0 ? "amber" : "neutral"}
                href={silent30 > 0 ? "/agency/clients?silence=30d" : undefined}
              />
              <StatCard
                label="60日以上対応なし"
                value={silent60}
                tone={silent60 > 0 ? "red" : "neutral"}
                href={silent60 > 0 ? "/agency/clients?silence=60d" : undefined}
              />
              <StatCard
                label="一度も対応なし"
                value={neverContacted}
                tone={neverContacted > 0 ? "amber" : "neutral"}
                href={neverContacted > 0 ? "/agency/clients?silence=never" : undefined}
              />
            </div>
          ),
          "my-tasks": (
            <MyTasksWidget
              tasks={myTasks.map((t) => ({
                id: t.id,
                title: t.title,
                dueAt: t.due_at,
                clientRecordId: t.client_record_id,
                clientName: clientNameMap.get(t.client_record_id) ?? "(顧客不明)",
              }))}
            />
          ),
          "recent-interactions": (
            <div className="space-y-2">
              <div className="text-muted-foreground flex items-center justify-end text-xs">
                {recentInteractions.length} 件
              </div>
              {recentInteractions.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  まだ対応履歴がありません
                </p>
              ) : (
                <ul className="divide-foreground/10 divide-y">
                  {recentInteractions.map((i) => {
                    const clientName = clientNameMap.get(i.client_record_id) ?? "(顧客不明)";
                    const title =
                      i.summary && i.summary.trim() !== ""
                        ? i.summary
                        : `${i.interaction_type} による対応`;
                    return (
                      <li key={i.id} className="py-2 text-sm">
                        <Link
                          href={`/agency/clients/${i.client_record_id}`}
                          className="hover:bg-accent flex flex-wrap items-baseline justify-between gap-2 rounded px-1 py-1"
                        >
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-medium">{title}</span>
                            <span className="text-muted-foreground text-xs">{clientName}</span>
                          </div>
                          <span className="text-muted-foreground text-xs whitespace-nowrap">
                            {new Date(i.occurred_at).toLocaleDateString("ja-JP")}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ),
          "data-quality": (
            <div className="space-y-3">
              <div className="text-muted-foreground flex flex-wrap items-center justify-end gap-2 text-xs">
                活動中の顧客 {dataQuality.evaluatedCount} 件のうち{" "}
                <span className="text-foreground font-medium">{completionRate}%</span> が完全入力(
                {dataQuality.completeCount} / {dataQuality.evaluatedCount})
              </div>
              {sortedQualityFields.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  未入力項目はありません
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {sortedQualityFields.map(({ field, count }) => {
                    const top = dataQuality.topMissingByField[field];
                    return (
                      <li
                        key={field}
                        className="ring-foreground/10 space-y-1 rounded-md p-2 ring-1"
                      >
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-medium">{DATA_QUALITY_FIELD_LABEL[field]}</span>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {count} 件
                          </span>
                        </div>
                        <div className="text-muted-foreground flex flex-wrap gap-1.5 text-xs">
                          {top.slice(0, 3).map((c) => (
                            <Link
                              key={c.id}
                              href={`/agency/clients/${c.id}`}
                              className="bg-muted hover:bg-accent rounded-full px-2 py-0.5"
                            >
                              {c.name}
                            </Link>
                          ))}
                          {count > 3 && <span className="px-1">他 {count - 3} 件</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ),
          duplicates:
            duplicates.length > 0 ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm">
                  重複候補が <strong>{duplicates.length} 件</strong> あります。
                </p>
                <Button render={<Link href="/agency/clients" />} variant="outline" size="sm">
                  クライアント一覧で確認
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground py-2 text-center text-sm">重複候補はありません</p>
            ),
          "quick-actions": (
            <div className="flex flex-wrap gap-2">
              <Button render={<Link href="/agency/clients/new" />}>+ クライアント登録</Button>
              <Button render={<Link href="/agency/calendar" />} variant="outline">
                カレンダー
              </Button>
              <Button render={<Link href="/agency/reports" />} variant="outline">
                レポート
              </Button>
            </div>
          ),
        }}
      />
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "amber" | "red";
  href?: string;
};

const TONE_RING: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "ring-foreground/10",
  amber: "ring-amber-300 bg-amber-50/50 dark:bg-amber-950/30",
  red: "ring-red-300 bg-red-50/50 dark:bg-red-950/30",
};

function StatCard({ label, value, hint, tone = "neutral", href }: StatCardProps) {
  const inner = (
    <Card className={`space-y-1 p-4 ring-1 ${TONE_RING[tone]}`}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground text-[10px]">{hint}</div>}
    </Card>
  );
  if (href) {
    return (
      <Link href={href} className="block transition-transform hover:-translate-y-0.5">
        {inner}
      </Link>
    );
  }
  return inner;
}
