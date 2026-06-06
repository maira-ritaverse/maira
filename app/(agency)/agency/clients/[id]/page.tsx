import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DiagnosisResultView } from "@/components/features/diagnosis/diagnosis-result-view";
import { getClientRecord } from "@/lib/clients/queries";
import { clientLinkStatusLabels, clientStatusLabels } from "@/lib/clients/types";
import { getDiagnosisForUser } from "@/lib/diagnosis/queries";
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

  // 紹介セクション・対応履歴・タスク・組織メンバー・成約イベントに加えて、
  // 診断結果(リンク済みクライアントのみ)も並行取得する。
  // 診断結果は client.linkStatus === "linked" の場合のみ求職者 user_id を辿って取得。
  // RLS で linked のみ可だが、コード側でも二重チェックして無駄なクエリを抑える。
  const linkedUserId = client.linkStatus === "linked" ? client.linkedUserId : null;
  const [referrals, allJobs, interactions, tasks, members, placements, diagnosis] =
    await Promise.all([
      listReferralsByClient(client.id),
      listJobPostings(role.organization.id),
      listInteractionsByClient(client.id, role.organization.id),
      listTasksByClient(client.id, role.organization.id),
      listOrganizationMembers(role.organization.id),
      listPlacementsByClient(client.id, role.organization.id),
      linkedUserId ? getDiagnosisForUser(linkedUserId) : Promise.resolve(null),
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

      {/* 連携状態に応じた案内カード */}
      {client.linkStatus === "unlinked" && (
        <Card className="border-muted-foreground/20 bg-muted/30 p-4">
          <p className="text-sm">
            このクライアントはまだMairaアカウントと連携していません。 求職者が{" "}
            <span className="font-medium">{client.email}</span> でMairaに登録し、
            連携を承諾すると、共有された書類などを閲覧できるようになります。
          </p>
        </Card>
      )}
      {client.linkStatus === "invited" && (
        <Card className="bg-muted/30 p-4">
          <p className="text-sm">連携招待を送信済みです。求職者の承諾を待っています。</p>
        </Card>
      )}
      {client.linkStatus === "linked" && (
        <Card className="border-green-200 bg-green-50/50 p-4 dark:border-green-900 dark:bg-green-950/30">
          <p className="text-sm">
            このクライアントはMairaアカウントと連携済みです。
            求職者が共有を許可した書類を閲覧できます(書類閲覧機能は今後追加予定)。
          </p>
        </Card>
      )}
      {client.linkStatus === "revoked" && (
        <Card className="bg-muted/30 p-4">
          <p className="text-sm">
            連携が解除されています。求職者が再度承諾するまで共有書類は閲覧できません。
          </p>
        </Card>
      )}

      <ClientDetailForm client={client} />

      {/* 診断結果(リンク済みクライアントが診断を受けていれば表示) */}
      {client.linkStatus === "linked" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">キャリア診断結果</h2>
            <p className="text-muted-foreground text-xs">
              本人が受けた診断の結果(軸・強み・職種候補)
            </p>
          </div>
          {diagnosis ? (
            <DiagnosisResultView diagnosis={diagnosis} />
          ) : (
            <Card className="p-4">
              <p className="text-muted-foreground text-sm">
                このクライアントはまだキャリア診断を受けていません
              </p>
            </Card>
          )}
        </section>
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
