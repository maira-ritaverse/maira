import { notFound, redirect } from "next/navigation";

import { getClientRecord } from "@/lib/clients/queries";
import { getJobPosting } from "@/lib/jobs/queries";
import { getUserRole } from "@/lib/organizations/queries";
import {
  getLetter,
  listLettersByReferral,
  listTemplates,
} from "@/lib/recommendation-letters/queries";
import { getReferral } from "@/lib/referrals/queries";
import { createClient } from "@/lib/supabase/server";

import { LetterEditor } from "./letter-editor";

/**
 * 推薦文編集ページ
 *
 * URL: /agency/recommendation-letters/[id]
 *
 * Server Component として letter / referral / job / client / 履歴 / テンプレを取得し、
 * クライアントコンポーネント LetterEditor に渡す。
 *
 * RLS で自社の letter しか取れないが、念のため getLetter が null を返したら
 * notFound() に倒す(別組織の id を踏んだときの 404 担保)。
 */

type RouteParams = { params: Promise<{ id: string }> };

export default async function RecommendationLetterEditPage({ params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const letter = await getLetter(id, role.organization.id);
  if (!letter) notFound();

  // referral / job / client / 履歴 / テンプレを並列取得
  const [referral, historySummaries, templates] = await Promise.all([
    getReferral(letter.referralId),
    listLettersByReferral(letter.referralId, role.organization.id),
    listTemplates(role.organization.id),
  ]);
  if (!referral || referral.organizationId !== role.organization.id) notFound();

  const [client, job] = await Promise.all([
    getClientRecord(referral.clientRecordId),
    getJobPosting(referral.jobPostingId),
  ]);
  if (!client || !job) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-6 lg:px-6">
      <LetterEditor
        letter={letter}
        client={{ id: client.id, name: client.name }}
        job={{ id: job.id, companyName: job.companyName, position: job.position }}
        organizationName={role.organization.name}
        templates={templates}
        historySummaries={historySummaries}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
