import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CancelInvitationButton,
  InviteClientButton,
} from "@/components/features/agency/link-action-buttons";
import { getClientRecord } from "@/lib/clients/queries";
import { clientLinkStatusLabels, clientStatusLabels } from "@/lib/clients/types";
import { listInteractionsByClient } from "@/lib/interactions/queries";
import { listJobPostings } from "@/lib/jobs/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { listPlacementsByClient } from "@/lib/placements/queries";
import {
  listReferralsByClient,
  listReferralStatusHistoriesByReferralIds,
} from "@/lib/referrals/queries";
import { listTasksByClient, listOrganizationMembers } from "@/lib/agency-tasks/queries";
import { createClient } from "@/lib/supabase/server";
import { ClientDetailForm } from "./client-detail-form";
import { DisclosableProfileSection } from "./disclosable-profile-section";
import { AgencyDocumentsSection } from "./documents-section";
import { InteractionsSection } from "./interactions-section";
import { ReferralSection } from "./referral-section";
import { TasksSection } from "./tasks-section";

/**
 * クライアント詳細画面
 *
 * RLS で自社のレコードしか取れないはずだが、念のため organizationId 一致を
 * 明示確認してから notFound() に倒す(他社の id を踏んだときの 404 担保)。
 */

type RouteParams = { params: Promise<{ id: string }> };

export default async function ClientDetailPage({ params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const client = await getClientRecord(id);
  if (!client || client.organizationId !== role.organization.id) {
    notFound();
  }

  // organization_member なら member は必ずあるはずだが、念のためのガード
  if (!role.member) {
    redirect("/app");
  }

  // 紹介セクション・対応履歴・タスク・組織メンバー・成約イベントを並行取得する。
  //
  // 開示フロー Phase 1:
  //   旧実装ではここで linked クライアントの career_profile から診断結果を
  //   復号して取得し、画面下部に表示していたが、新方針では career_profile
  //   (diagnosis を含む内面的自己分析)はエージェント非開示としたため取得しない。
  //   同コミットで RLS ポリシー
  //   "Org members can view linked client career profile" も撤去している。
  //   開示する書類(resumes/cvs)や希望条件(career_profile.wants / user_facts)は
  //   後続 Phase で別経路で開く。
  const [referrals, allJobs, interactions, tasks, members, placements] = await Promise.all([
    listReferralsByClient(client.id),
    listJobPostings(role.organization.id),
    listInteractionsByClient(client.id, role.organization.id),
    listTasksByClient(client.id, role.organization.id),
    listOrganizationMembers(role.organization.id),
    listPlacementsByClient(client.id, role.organization.id),
  ]);
  const openJobs = allJobs.filter((j) => j.status === "open");

  // 紹介の status 遷移履歴(referral_id でグルーピングされた Map)。
  // 必要な referralIds が referrals 取得結果に依存するので、Promise.all の後に直列で取得。
  // 履歴は referral_section.tsx 内の各紹介行に「選考の足跡」として表示する。
  const historiesByReferral = await listReferralStatusHistoriesByReferralIds(
    referrals.map((r) => r.id),
    role.organization.id,
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
              {clientStatusLabels[client.status]}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                client.linkStatus === "linked"
                  ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {clientLinkStatusLabels[client.linkStatus]}
            </span>
          </div>
        </div>
        <Button render={<Link href="/agency/clients" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      {/* 連携状態に応じた案内カードとアクション */}
      {client.linkStatus === "unlinked" && (
        <Card className="border-muted-foreground/20 bg-muted/30 space-y-3 p-4">
          <p className="text-sm">
            このクライアントはまだMairaアカウントと連携していません。 求職者が{" "}
            <span className="font-medium">{client.email}</span> でMairaに登録した後、
            「連携を招待する」を押すと招待が届き、求職者が承諾すると共有書類を閲覧できます。
          </p>
          <InviteClientButton clientRecordId={client.id} />
        </Card>
      )}
      {client.linkStatus === "invited" && (
        <Card className="bg-muted/30 flex items-center justify-between gap-4 p-4">
          <p className="text-sm">連携招待を送信済みです。求職者の承諾を待っています。</p>
          <CancelInvitationButton clientRecordId={client.id} />
        </Card>
      )}
      {client.linkStatus === "linked" && (
        <Card className="border-green-200 bg-green-50/50 p-4 dark:border-green-900 dark:bg-green-950/30">
          <p className="text-sm">
            このクライアントはMairaアカウントと連携済みです。下の「共有された書類」セクションから
            履歴書・職務経歴書を閲覧できます。
          </p>
        </Card>
      )}
      {client.linkStatus === "revoked" && (
        <Card className="bg-muted/30 space-y-3 p-4">
          <p className="text-sm">
            連携が解除されています。求職者が再度承諾するまで共有書類は閲覧できません。
            再度招待を送ることができます。
          </p>
          <InviteClientButton clientRecordId={client.id} />
        </Card>
      )}

      <ClientDetailForm client={client} />

      {/* linked のときのみ希望条件・書類閲覧セクションを描画。
          認可は DB 側(documents は RLS、希望条件は SECURITY DEFINER RPC)で
          二重防御されるが、UI 側でも条件分岐して無駄なクエリを抑える。
          希望条件 → 書類の順で「人物理解 → 詳細書類」の自然な閲覧導線にする。 */}
      {client.linkStatus === "linked" && client.linkedUserId && (
        <>
          <DisclosableProfileSection clientRecordId={client.id} />
          <AgencyDocumentsSection linkedUserId={client.linkedUserId} clientRecordId={client.id} />
        </>
      )}

      <InteractionsSection
        clientId={client.id}
        interactions={interactions}
        isAdmin={role.member.role === "admin"}
      />

      <TasksSection
        clientId={client.id}
        tasks={tasks}
        members={members}
        currentMemberId={role.member.id}
        isAdmin={role.member.role === "admin"}
      />

      <ReferralSection
        clientId={client.id}
        referrals={referrals}
        openJobs={openJobs}
        placements={placements}
        historiesByReferral={historiesByReferral}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
