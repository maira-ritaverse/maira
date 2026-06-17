import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/api/auth-guards";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * /app/recommendation-letters/[id]
 *
 * 求職者本人向け:1 件の finalized 推薦文の詳細(本文込み)。
 *
 * 認可:/api/me/recommendation-letters/[id] と同じ 4 段ガード。
 *   1. requireUser
 *   2. status=finalized
 *   3. referral → client_record の linked_user_id 一致
 *   4. 不一致なら notFound()(他人の存在を隠す)
 */
type RouteParams = { params: Promise<{ id: string }> };

type ClientRecordRef = {
  linked_user_id: string | null;
  link_status: string | null;
};

type ReferralRef = {
  id: string;
  client_records: ClientRecordRef | ClientRecordRef[] | null;
  job_postings:
    | { company_name: string; position: string }
    | { company_name: string; position: string }[]
    | null;
};

type LetterRow = {
  id: string;
  referral_id: string;
  organization_id: string;
  encrypted_headline: string;
  encrypted_body: string;
  finalized_at: string | null;
  version: number;
};

async function loadLetter(id: string, userId: string) {
  const service = createServiceClient();

  const { data: letterRow } = await service
    .from("recommendation_letters")
    .select(
      "id, referral_id, organization_id, encrypted_headline, encrypted_body, finalized_at, version",
    )
    .eq("id", id)
    .eq("status", "finalized")
    .maybeSingle();
  if (!letterRow) return null;
  const letter = letterRow as LetterRow;

  const { data: referralRow } = await service
    .from("referrals")
    .select(
      `
      id,
      client_records ( linked_user_id, link_status ),
      job_postings ( company_name, position )
    `,
    )
    .eq("id", letter.referral_id)
    .maybeSingle();
  if (!referralRow) return null;
  const referral = referralRow as unknown as ReferralRef;
  const clientRecord = Array.isArray(referral.client_records)
    ? referral.client_records[0]
    : referral.client_records;
  if (
    !clientRecord ||
    clientRecord.link_status !== "linked" ||
    clientRecord.linked_user_id !== userId
  ) {
    return null;
  }

  const { data: orgRow } = await service
    .from("organizations")
    .select("name")
    .eq("id", letter.organization_id)
    .maybeSingle();
  const organizationName = (orgRow as { name: string } | null)?.name ?? "エージェント";

  const [headline, body] = await Promise.all([
    decryptField(letter.encrypted_headline),
    decryptField(letter.encrypted_body),
  ]);
  const jp = referral.job_postings;
  const jobPosting = Array.isArray(jp) ? jp[0] : jp;
  const jobLabel = jobPosting ? `${jobPosting.company_name} / ${jobPosting.position}` : "求人";

  return {
    organizationName,
    jobLabel,
    headline: headline ?? "",
    body: body ?? "",
    finalizedAt: letter.finalized_at,
    version: letter.version,
  };
}

export default async function SeekerRecommendationLetterDetailPage({ params }: RouteParams) {
  const { id } = await params;
  const guard = await requireUser();
  if (!guard.ok) return null;
  const data = await loadLetter(id, guard.user.id);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/app/recommendation-letters" />}>
          ← 一覧へ戻る
        </Button>
      </div>

      <Card className="p-6 sm:p-8">
        <div className="text-muted-foreground mb-3 text-xs">
          {data.organizationName} ・ {data.jobLabel}
          {data.finalizedAt && (
            <> ・ {new Date(data.finalizedAt).toLocaleDateString("ja-JP")} 受領</>
          )}
        </div>
        <h1 className="text-foreground mb-6 text-2xl leading-snug font-bold">
          {data.headline || "(タイトルなし)"}
        </h1>
        <article className="prose prose-sm dark:prose-invert max-w-none">
          {data.body.split(/\n+/).map((para, i) => (
            <p key={i} className="leading-relaxed whitespace-pre-wrap">
              {para}
            </p>
          ))}
        </article>
      </Card>

      <p className="text-muted-foreground text-xs">
        この推薦文はエージェントが求人企業に提出するためのものです。内容に誤りや事実と異なる点があれば、担当エージェントにご連絡ください。
      </p>
    </div>
  );
}
