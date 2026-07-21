import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SeekerMeetingCard } from "@/components/features/meetings/seeker-meeting-card";
import type { MeetingScheduleView } from "@/lib/meetings/types";

type Props = {
  /**
   * 今後の面談予定。新規ユーザー(棚卸し未実施)でも、エージェントが
   * 既に面談を予約していれば「参加」ボタンを最上段に出す必要があるので
   * empty 段階のダッシュボードでも meetings を受け取る。
   */
  upcomingMeetings: MeetingScheduleView[];
};

/**
 * 初回ユーザー(career_profile なし)向けのダッシュボード。
 *
 * 何もデータがないので、まずキャリア棚卸しに誘導することに専念する。
 * 4 機能の説明カードはアプリ全体の理解を助けるために併記する。
 *
 * ただし「招待されて作ったばかりだが既に面談が組まれている」ケースが
 * 想定されるため、面談カードは最上段に置いて 参加 URL に即アクセスできる
 * ようにする(starter / active と同じ SeekerMeetingCard を再利用)。
 */
export function DashboardEmpty({ upcomingMeetings }: Props) {
  return (
    <div className="space-y-6">
      {/* 面談が組まれていれば最優先で表示(参加ボタン込み)*/}
      <SeekerMeetingCard meetings={upcomingMeetings} />

      {/* メインCTA:棚卸し導線を強調表示 */}
      <Card className="border-primary/40 bg-primary/5 p-6">
        <h2 className="text-lg font-bold">まずはキャリア棚卸しから始めましょう</h2>
        <p className="mt-2 text-sm">
          Myairaと雑談感覚で5-10分話すだけで、あなたの強みや希望が綺麗に整理されます。
          整理結果は、書類作成や応募相談に自動的に活用されます。
        </p>
        <Button render={<Link href="/app/career/new" />} className="mt-4">
          キャリア棚卸しを始める
        </Button>
      </Card>

      {/* 主要機能の概要(現状カードは 3 枚。 音声面接シミュレーターは β 版でまだ導入していないため出さない)*/}
      <div>
        <h2 className="mb-3 text-lg font-bold">Myairaができること</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-5">
            <p className="font-medium">キャリア棚卸し</p>
            <p className="text-muted-foreground mt-2 text-sm">
              雑談形式の対話で、あなたの強み・価値観・希望を構造化します
            </p>
          </Card>
          <Card className="p-5">
            <p className="font-medium">書類作成</p>
            <p className="text-muted-foreground mt-2 text-sm">
              履歴書・職務経歴書・志望動機・自己PRを、あなたの棚卸し結果から自動生成
            </p>
          </Card>
          <Card className="p-5">
            <p className="font-medium">応募管理 + Myaira相談</p>
            <p className="text-muted-foreground mt-2 text-sm">
              応募の進捗管理 + ポップアップでいつでもMyairaに相談できる
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
