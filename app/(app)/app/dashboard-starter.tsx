import Link from "next/link";
import { AptitudeRadar } from "@/components/features/diagnosis/aptitude-radar";
import { InterviewShareCard } from "@/components/features/meetings/interview-share-card";
import { SeekerMeetingCard } from "@/components/features/meetings/seeker-meeting-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { axisTypeLabels } from "@/lib/diagnosis/axis-questions";
import { DashboardSuggestions } from "./dashboard-suggestions";
import { generateSuggestions } from "@/lib/dashboard/suggestions";
import type { DashboardData } from "@/lib/dashboard/queries";

type Props = {
  data: DashboardData;
};

/**
 * 棚卸し済みだがまだ応募活動が始まっていないユーザー向けのダッシュボード。
 *
 * Phase 2 で「次のステップ」プレースホルダーを DashboardSuggestions に置き換え。
 * サジェストが空の場合は何も表示されない(セクション見出しごと出ない)。
 */
export function DashboardStarter({ data }: Props) {
  const suggestions = generateSuggestions(data);
  const diagnosis = data.career.profileData?.diagnosis;

  return (
    <div className="space-y-6">
      {/* 上段:診断カード + キャリアサマリーを横並び(lg 以上)。
          モバイルは縦並びにして窮屈にならないように。 */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* キャリア診断カード:レーダー + 軸を visible に */}
        {diagnosis ? (
          <Card className="space-y-3 p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-muted-foreground text-xs">あなたの軸</p>
                <p className="text-base font-semibold">
                  {axisTypeLabels[diagnosis.axis.primary]}
                  {diagnosis.axis.secondary && (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      次いで {axisTypeLabels[diagnosis.axis.secondary]}
                    </span>
                  )}
                </p>
              </div>
              <Button variant="outline" size="sm" render={<Link href="/app/diagnosis/result" />}>
                診断結果
              </Button>
            </div>
            <div className="flex justify-center">
              <div className="aspect-square w-full max-w-65">
                <AptitudeRadar scores={diagnosis.aptitude.scores} />
              </div>
            </div>
          </Card>
        ) : (
          // 未診断ユーザーには軽い誘導を出す(starter 段階は棚卸し済みなので、診断は次の一歩)
          <Card className="border-primary/30 bg-primary/5 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">キャリア診断を受けてみませんか</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  5〜7分で、自分の軸と強みが分かります
                </p>
              </div>
              <Button size="sm" render={<Link href="/app/diagnosis" />}>
                診断へ
              </Button>
            </div>
          </Card>
        )}

        {/* キャリアサマリー */}
        {data.career.profileData && (
          <Card className="border-primary/40 bg-primary/5 p-6">
            <div className="flex h-full items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  あなたのキャリア(v{data.career.profileVersion})
                </p>
                <p className="text-sm leading-relaxed">{data.career.profileData.summary}</p>
                <p className="text-muted-foreground mt-3 text-xs">
                  強み {data.career.profileData.strengths.length}個 ・{" "}
                  {data.career.conversationCount}
                  件の棚卸し会話
                </p>
              </div>
              <Button render={<Link href="/app/career" />} variant="outline" size="sm">
                詳細
              </Button>
            </div>
          </Card>
        )}
      </div>

      <InterviewShareCard shares={data.pendingInterviewShares} />
      <SeekerMeetingCard meetings={data.upcomingMeetings} />

      <DashboardSuggestions suggestions={suggestions} />

      {/* 既存応募サマリー(1〜2件あるケース) */}
      {data.applications.total > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">応募管理</h2>
            <Button render={<Link href="/app/applications" />} variant="outline" size="sm">
              すべて見る
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {data.applications.total}件の応募を管理中
          </p>
        </Card>
      )}

      {/* 新機能の動線(starter 段階でも気付けるように) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="p-4">
          <p className="font-medium">面接練習(β)</p>
          <p className="text-muted-foreground mt-1 text-xs">
            ベテラン面接官 AI による模擬面接。音声入力 / 読み上げ対応。
          </p>
          <Button
            render={<Link href="/app/interview" />}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            試してみる
          </Button>
        </Card>
        <Card className="p-4">
          <p className="font-medium">履歴書 AI 添削</p>
          <p className="text-muted-foreground mt-1 text-xs">
            登録した履歴書を AI が採用担当者の視点で添削します。
          </p>
          <Button
            render={<Link href="/app/resumes" />}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            履歴書を作る
          </Button>
        </Card>
      </div>
    </div>
  );
}
