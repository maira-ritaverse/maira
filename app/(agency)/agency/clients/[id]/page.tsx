import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientSummaryCard } from "@/components/features/agency/client-summary-card";
import {
  ApproveRevokeButton,
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

  if (!user) redirect("/login");

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
                  : client.linkStatus === "revoke_requested"
                    ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
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
      {client.linkStatus === "revoke_requested" && (
        <RevokeRequestedCard
          clientRecordId={client.id}
          revokeRequestedAt={client.revokeRequestedAt}
          revokeDeadline={client.revokeDeadline}
        />
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

      <ClientSummaryCard clientId={client.id} />

      <ClientDetailForm client={client} />

      {/* linked または期限内 revoke_requested のときに希望条件・書類閲覧セクションを描画。
          認可は DB 側(documents は RLS、希望条件は SECURITY DEFINER RPC)で
          二重防御されるが、UI 側でも条件分岐して無駄なクエリを抑える。
          希望条件 → 書類の順で「人物理解 → 詳細書類」の自然な閲覧導線にする。
          revoke_requested で期限超過の場合は RLS / RPC が 0 件 / forbidden を返すため、
          セクション自体は表示されるが中身が「閲覧できる書類はありません」になる
          (本人 UX から見て、申請後も猶予期間内は引き続き開示する設計の鏡像)。 */}
      {(client.linkStatus === "linked" || client.linkStatus === "revoke_requested") &&
        client.linkedUserId && (
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

// ====================================================================
// revoke_requested ケース用のカード
//
// 「申請が届いている」事実 + 申請日時 + 残り日数 + 承認ボタンを表示。
// 期限超過後の見かけ更新は P6 cron が担うため、それまでは link_status が
// revoke_requested のまま「期限切れ(あと約 ─1 日)」のように表示されうる。
// その状態でも承認(後始末としての即時 revoked 確定)は受け付けるため、
// 承認ボタンは期限状態に関わらず常に出す。
// ====================================================================
function RevokeRequestedCard({
  clientRecordId,
  revokeRequestedAt,
  revokeDeadline,
}: {
  clientRecordId: string;
  revokeRequestedAt: string | null;
  revokeDeadline: string | null;
}) {
  const daysLeft = computeDaysLeft(revokeDeadline);
  return (
    <Card className="space-y-3 border-orange-200 bg-orange-50/50 p-4 dark:border-orange-900 dark:bg-orange-950/30">
      <div className="space-y-1">
        <p className="text-sm font-medium">この求職者から連携解除の申請が届いています。</p>
        <p className="text-muted-foreground text-xs">
          申請日時:{formatDateTime(revokeRequestedAt)}
        </p>
        <p className="text-muted-foreground text-xs">
          自動停止予定:{formatDateTime(revokeDeadline)}
          {daysLeft !== null && (
            <span className="ml-2">({daysLeft > 0 ? `あと約 ${daysLeft} 日` : "期限切れ"})</span>
          )}
        </p>
      </div>
      <p className="text-muted-foreground text-xs">
        承認すると即座に履歴書・職務経歴書・希望条件の閲覧が停止します。
        承認しなくても、猶予期限の経過で自動的に停止します。
        停止までの間は引き続き書類を閲覧できます。
      </p>
      <ApproveRevokeButton clientRecordId={clientRecordId} />
    </Card>
  );
}

function computeDaysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
