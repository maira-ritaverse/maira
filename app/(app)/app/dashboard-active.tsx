import Link from "next/link";
import { AptitudeRadar } from "@/components/features/diagnosis/aptitude-radar";
import { InterviewShareCard } from "@/components/features/meetings/interview-share-card";
import { SeekerMeetingCard } from "@/components/features/meetings/seeker-meeting-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { applicationStatusBadgeClasses, applicationStatusLabels } from "@/lib/applications/types";
import { axisTypeLabels } from "@/lib/diagnosis/axis-questions";
import { DashboardSuggestions } from "./dashboard-suggestions";
import { generateSuggestions } from "@/lib/dashboard/suggestions";
import type { DashboardData } from "@/lib/dashboard/queries";

type Props = {
  data: DashboardData;
};

/**
 * 進行中の応募が複数あるアクティブユーザー向けのダッシュボード。
 *
 * Phase 2 の変更:
 * - 「期限が迫っているタスク」専用セクションを削除
 *   (overdue / dueToday はサジェストに集約されるため重複回避)
 * - サジェストを最上部に配置(行動の起点として優先表示)
 * - 4 機能動線の右側を「タスク」に置き換え、/app/tasks の横断ビューへ誘導
 */
export function DashboardActive({ data }: Props) {
  const suggestions = generateSuggestions(data);
  const diagnosis = data.career.profileData?.diagnosis;

  return (
    <div className="space-y-6">
      {/* 上段:キャリアサマリー + 診断サムネを横並び(lg 以上)。
          関連情報を近くに置いて視線移動を減らす。モバイルは縦。 */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {/* キャリアサマリー(コンパクト版) */}
        {data.career.profileData && (
          <Card className="border-primary/40 bg-primary/5 p-4">
            <div className="flex h-full items-center justify-between gap-4">
              <p className="line-clamp-3 flex-1 text-sm">{data.career.profileData.summary}</p>
              <Button render={<Link href="/app/career" />} variant="outline" size="sm">
                詳細
              </Button>
            </div>
          </Card>
        )}

        {/* 診断結果コンパクト表示(active は応募中心のため、サムネ的に表示) */}
        {diagnosis && (
          <Card className="p-4">
            <div className="flex h-full items-center gap-4">
              {/* ラベル省略の小サイズレーダー */}
              <div className="aspect-square w-24 shrink-0">
                <AptitudeRadar scores={diagnosis.aptitude.scores} showLabels={false} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-xs">あなたの軸</p>
                <p className="truncate text-sm font-semibold">
                  {axisTypeLabels[diagnosis.axis.primary]}
                </p>
                {diagnosis.axis.secondary && (
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    次いで {axisTypeLabels[diagnosis.axis.secondary]}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" render={<Link href="/app/diagnosis/result" />}>
                詳細
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* エージェントからのキャリア棚卸し追加(承認待ち) */}
      <InterviewShareCard shares={data.pendingInterviewShares} />

      {/* エージェント主催の Web 面談 — 参加することだけにフォーカスした軽量カード */}
      <SeekerMeetingCard meetings={data.upcomingMeetings} />

      <DashboardSuggestions suggestions={suggestions} maxDisplay={3} />

      {/* 下段:進行中の応募 + 他機能動線を横並び(lg 以上)。
          応募一覧を左に大きめ(2/3 幅)、動線を右にコンパクトに置く。 */}
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        {/* 進行中の応募(最大5件) */}
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">進行中の応募</h2>
            <Button render={<Link href="/app/applications" />} variant="outline" size="sm">
              すべて見る
            </Button>
          </div>
          {data.applications.inProgress.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">進行中の応募はありません</p>
          ) : (
            <div className="mt-3 space-y-2">
              {data.applications.inProgress.slice(0, 5).map((app) => (
                <Link
                  key={app.id}
                  href={`/app/applications/${app.id}`}
                  className="hover:bg-accent block rounded-lg border p-3 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{app.details.company}</p>
                    {/* 状態色付きバッジ:一目で進捗 phase that分かる */}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${applicationStatusBadgeClasses[app.status]}`}
                    >
                      {applicationStatusLabels[app.status]}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {app.details.position}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* 他機能への動線(右側カラム、縦並び) */}
        <div className="space-y-3">
          <Card className="p-4">
            <p className="font-medium">書類作成</p>
            <p className="text-muted-foreground mt-1 text-xs">{data.documents.count}件作成済み</p>
            <Button
              render={<Link href="/app/documents" />}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              書類を見る
            </Button>
          </Card>
          <Card className="p-4">
            <p className="font-medium">タスク</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {data.tasks.total}件
              {data.tasks.overdue.length > 0 && ` (期限超過 ${data.tasks.overdue.length})`}
            </p>
            <Button
              render={<Link href="/app/tasks" />}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              タスクを見る
            </Button>
          </Card>
        </div>
      </div>

      {/* 新機能(β含む)への動線:面接練習 / 履歴書 AI 添削 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="p-4">
          <p className="font-medium">面接練習(β)</p>
          <p className="text-muted-foreground mt-1 text-xs">
            ベテラン面接官 AI が 5〜8 問の質問 + フィードバックを返します。 音声入力 /
            読み上げ対応。
          </p>
          <Button
            render={<Link href="/app/interview" />}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            面接練習を始める
          </Button>
        </Card>
        <Card className="p-4">
          <p className="font-medium">履歴書 AI 添削</p>
          <p className="text-muted-foreground mt-1 text-xs">
            登録した履歴書を AI が採用担当者の視点で添削。具体的なリライト例を返します。
          </p>
          <Button
            render={<Link href="/app/resumes" />}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            履歴書を見る
          </Button>
        </Card>
      </div>

      {/* 未読通知バッジ(エージェントからのアクション通知などがあるとき) */}
      {data.unreadNotificationCount > 0 && (
        <Card className="border-rose-300 bg-rose-50/40 p-4 dark:border-rose-900 dark:bg-rose-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              🔔 新着のお知らせが {data.unreadNotificationCount} 件あります
            </p>
            <Button render={<Link href="/app/agent-referrals" />} size="sm" variant="outline">
              進捗を確認
            </Button>
          </div>
        </Card>
      )}

      {/* AI 利用量サマリ(残量警告がある場合のみ表示) */}
      {data.aiUsageSummary.hasWarning && (
        <Card className="border-amber-300 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="font-medium">今月の AI 利用が上限に近づいています</p>
          <ul className="text-muted-foreground mt-2 ml-4 list-disc text-xs">
            <li>
              AI 写真: {data.aiUsageSummary.photo.current} / {data.aiUsageSummary.photo.limit} 回
            </li>
            <li>
              AI 推薦: {data.aiUsageSummary.recommendation.current} /{" "}
              {data.aiUsageSummary.recommendation.limit} 回
            </li>
            <li>
              AI ヒアリング: {data.aiUsageSummary.intake.current} /{" "}
              {data.aiUsageSummary.intake.limit} 件
            </li>
          </ul>
          <Button
            render={<Link href="/app/settings/integrations" />}
            size="sm"
            variant="outline"
            className="mt-3"
          >
            設定で詳細を見る
          </Button>
        </Card>
      )}

      {/* エージェントが進めている推薦の進捗(linked クライアントのみ) */}
      {data.jobRecommendations.hasLinkedAgencyJobs && (
        <Card className="border-blue-300 bg-blue-50/40 p-4 dark:border-blue-900 dark:bg-blue-950/20">
          <p className="font-medium">エージェントの推薦進捗</p>
          <p className="text-muted-foreground mt-1 text-xs">
            連携エージェンシーが進めている求人推薦の状況(書類選考・面接など)を一覧で確認できます。
          </p>
          <Button
            render={<Link href="/app/agent-referrals" />}
            size="sm"
            className="mt-3"
            variant="outline"
          >
            進捗を見る
          </Button>
        </Card>
      )}

      {/* 連携エージェンシーの求人を AI で診断・推薦 */}
      {data.jobRecommendations.hasLinkedAgencyJobs && (
        <Card
          className={`p-4 ${
            data.jobRecommendations.hasFreshSignal
              ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/40"
              : "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">AI 求人推薦 — あなたの棚卸し・診断から</p>
            {data.jobRecommendations.hasFreshSignal && (
              <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200">
                NEW
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {data.jobRecommendations.hasFreshSignal
              ? "棚卸しが更新されました。あなたへの推薦も新しく組み直されています。"
              : "連携エージェンシーが扱う求人から、キャリア棚卸しと診断結果に基づいて AI がマッチ度の高い求人を TOP 5 でランキングします。"}
          </p>
          <Button render={<Link href="/app/recommended-jobs" />} size="sm" className="mt-3">
            {data.jobRecommendations.hasFreshSignal ? "新しい推薦を見る" : "推薦求人を見る"}
          </Button>
        </Card>
      )}
    </div>
  );
}
