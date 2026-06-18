import { Card } from "@/components/ui/card";
import { listAgencyApplications } from "@/lib/agency-client-documents/queries";
import { listReferralsByClient } from "@/lib/referrals/queries";
import { listJobPostings } from "@/lib/jobs/queries";

import { AgencyApplicationsList } from "./agency-applications-list";

type Props = {
  organizationId: string;
  clientRecordId: string;
};

/**
 * 代行応募(agency_applications)セクション。
 *
 * 表示構造:
 *   ・紹介(referrals)× 代行応募 の関係を 1 行ずつ並べる
 *   ・referral ごとに「代行応募として記録」「ステータス更新」「削除」が可能
 *   ・既存の応募がある referral は「応募済み」表示、無い referral は
 *     「+ 代行応募を記録」ボタンを表示
 */
export async function AgencyApplicationsSection({ organizationId, clientRecordId }: Props) {
  const [referrals, applications, allJobs] = await Promise.all([
    listReferralsByClient(clientRecordId),
    listAgencyApplications(clientRecordId, organizationId),
    listJobPostings(organizationId),
  ]);

  const jobMap = new Map(allJobs.map((j) => [j.id, j]));
  // referral_id → application
  const appByReferral = new Map(applications.map((a) => [a.referralId, a]));

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        エージェントがクライアントに代わって求人に応募した記録。各紹介(referral)に対して 1
        件まで代行応募を記録できます。
      </p>

      {referrals.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-sm">
          紹介がまだありません。先に「推薦・選考管理」で求人を紹介してください。
        </Card>
      ) : (
        <AgencyApplicationsList
          clientRecordId={clientRecordId}
          referrals={referrals.map((r) => ({
            id: r.id,
            jobPostingId: r.jobPostingId,
            companyName: jobMap.get(r.jobPostingId)?.companyName ?? "(求人不明)",
            position: jobMap.get(r.jobPostingId)?.position ?? "",
            existingApplication: appByReferral.get(r.id) ?? null,
          }))}
        />
      )}
    </div>
  );
}
