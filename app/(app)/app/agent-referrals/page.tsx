import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import {
  SEEKER_REFERRAL_STATUS_LABEL,
  SEEKER_REFERRAL_STATUS_TONE,
  isRecentlyUpdated,
  listSeekerReferrals,
} from "@/lib/seeker-referrals/queries";
import { createClient } from "@/lib/supabase/server";

import { TrackAsApplicationButton } from "./track-as-application-button";

/**
 * 求職者向け:エージェントが進めている推薦の進捗一覧
 *
 * - 自分が linked された agency の referrals を、求人 + agency 名つきで時系列表示
 * - 7 日以内に更新されたものは「NEW」バッジで強調
 * - ステータスは agency の referrals enum と同じ(planned / recommended / ... / declined)
 */
export default async function AgentReferralsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const referrals = await listSeekerReferrals();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/app" className="hover:underline">
            ← ダッシュボード
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">エージェントの推薦進捗</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          連携エージェンシーがあなたのために進めている求人推薦の進捗です。書類選考や面接の状況は
          エージェント担当者が更新します。
        </p>
      </div>

      {referrals.length === 0 && (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          現在、エージェントが進めている推薦はありません。
          <br />
          <Link
            href="/app/recommended-jobs"
            className="text-foreground mt-1 inline-block underline-offset-4 hover:underline"
          >
            AI 推薦から「応募を依頼」する →
          </Link>
        </Card>
      )}

      {referrals.length > 0 && (
        <ul className="space-y-3">
          {referrals.map((r) => {
            const recent = isRecentlyUpdated(r.updatedAt);
            return (
              <Card key={r.referralId} className="space-y-2 p-4">
                <Link
                  href={`/app/jobs/${r.jobPostingId}`}
                  className="block space-y-2 hover:opacity-80"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {r.jobCompanyName} ・ {r.jobPosition}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        {r.organizationName} 経由
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {recent && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          NEW
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEEKER_REFERRAL_STATUS_TONE[r.status]}`}
                      >
                        {SEEKER_REFERRAL_STATUS_LABEL[r.status]}
                      </span>
                    </div>
                  </div>
                  <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {r.jobLocation && <span>勤務地:{r.jobLocation}</span>}
                    {(r.jobSalaryMin || r.jobSalaryMax) && (
                      <span>
                        年収:{r.jobSalaryMin ?? "?"}〜{r.jobSalaryMax ?? "?"} 万円
                      </span>
                    )}
                    {r.jobEmploymentType && <span>雇用形態:{r.jobEmploymentType}</span>}
                  </div>
                </Link>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-[10px]">
                    最終更新:{new Date(r.updatedAt).toLocaleString("ja-JP")}
                  </p>
                  <TrackAsApplicationButton referralId={r.referralId} />
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
