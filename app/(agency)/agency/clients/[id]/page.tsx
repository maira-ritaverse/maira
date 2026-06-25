import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientSummaryCard } from "@/components/features/agency/client-summary-card";
import {
  ApproveRevokeButton,
  CancelInvitationButton,
  InviteClientButton,
  ResendInvitationButton,
} from "@/components/features/agency/link-action-buttons";
import { getClientRecordWithDecrypted } from "@/lib/clients/queries";
import { clientLinkStatusLabels, clientStatusLabels } from "@/lib/clients/types";
import { recordClientViewed } from "@/lib/clients/view-tracking";
import { listInteractionsByClient } from "@/lib/interactions/queries";
import { listJobPostings } from "@/lib/jobs/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { listPlacementsByClient } from "@/lib/placements/queries";
import { listLatestLetterSummariesByReferralIds } from "@/lib/recommendation-letters/queries";
import {
  listReferralsByClient,
  listReferralStatusHistoriesByReferralIds,
} from "@/lib/referrals/queries";
import { listTasksByClient, listOrganizationMembers } from "@/lib/agency-tasks/queries";
import { listCollaboratorsForClient } from "@/lib/clients/collaborators";
import { listClientAuditLog } from "@/lib/audit/client-audit-log";
import { createClient } from "@/lib/supabase/server";
import { buildActivityTimeline } from "@/lib/clients/activity-timeline";
import { rowToCustomFieldDefinition, type CustomFieldDefinition } from "@/lib/custom-fields/types";
import { SectionLayoutContainer } from "@/components/features/layout/section-layout-container";
import { getLinkedSeekerLatestPhoto } from "@/lib/agency/seeker-photo";

import { ActivityTimelineSection } from "./activity-timeline-section";
import { AuditLogSection } from "./audit-log-section";
import { ClientDetailForm } from "./client-detail-form";
import { CollaboratorsSection } from "./collaborators-section";
import { CustomFieldsSection } from "./custom-fields-section";
import { AiMatchingSection } from "./ai-matching-section";
import { MatchingSection } from "./matching-section";
import { ProposeMeetingButton } from "./propose-meeting-button";
import { ScheduleMeetingDialog } from "./schedule-meeting-dialog";
import { SendEmailDialog } from "./send-email-dialog";
import { AgencyApplicationsSection } from "./agency-applications-section";
import { AgencyCvsSection } from "./agency-cvs-section";
import { AgencyResumesSection } from "./agency-resumes-section";
import { DisclosableProfileSection } from "./disclosable-profile-section";
import { AgencyDocumentsSection } from "./documents-section";
import { HearingSheetsSection } from "./hearing-sheets-section";
import { InteractionsSection } from "./interactions-section";
import { IntakeUploadSection } from "./intake-upload-section";
import { MeetingHistorySection } from "./meeting-history-section";
import { ReferralSection } from "./referral-section";
import { TasksSection } from "./tasks-section";

/**
 * クライアント詳細画面
 *
 * RLS で自社のレコードしか取れないはずだが、念のため organizationId 一致を
 * 明示確認してから notFound() に倒す(他社の id を踏んだときの 404 担保)。
 */

type RouteParams = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
};

/**
 * クライアント詳細画面のタブ定義(7 + 履歴)
 *
 * 設計判断:
 *   情報量が多いため、トップレベルを「タブ」で大分類し、その中で従来の
 *   SectionLayoutContainer による並び替えを許す。タブ間の切替は URL の
 *   ?tab= で持つ(シェア可能 / リロードで状態保持)。
 *
 *   各タブ毎に SectionLayoutContainer の localStorage キーを分けることで、
 *   並び替え設定もタブ単位で独立する。
 */
const TABS = [
  { id: "overview", label: "基本情報" },
  { id: "crm", label: "対応・タスク" },
  { id: "meetings", label: "面談・ヒアリング" },
  { id: "documents", label: "書類" },
  { id: "jobs", label: "求人・応募" },
  { id: "seeker", label: "求職者プロフィール" },
  { id: "audit", label: "履歴" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function normalizeTab(raw: string | undefined): TabId {
  if (raw && TABS.some((t) => t.id === raw)) return raw as TabId;
  return "overview";
}

export default async function ClientDetailPage({ params, searchParams }: RouteParams) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const activeTab = normalizeTab(rawTab);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  // 詳細画面では暗号化フィールド(推薦コメント等)も復号した拡張型を取る。
  // 一覧クエリで使うと N+1 になるため、ここだけで使う。
  const client = await getClientRecordWithDecrypted(id);
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
  // 新着バッジ用の閲覧記録 upsert を並列に乗せる。
  // organizationId は必ず認可確認に通った client.organizationId を使う(role.organization.id と
  // 一致確認済み)。RLS は organization_id = current_user_organization_id() を要求するため、
  // ここでズレた値を渡すと RLS で弾かれて「ずっと新着のまま」になる。
  // 失敗時はビューワー内で握って警告ログのみ(致命にしない)。
  // 並列取得。recordClientViewed は void(閲覧記録だけ)なので _ で受ける。
  const [
    referrals,
    allJobs,
    interactions,
    tasks,
    members,
    placements,
    _viewed,
    auditLog,
    seekerPhoto,
    lineLinkRes,
    collaborators,
  ] = await Promise.all([
    listReferralsByClient(client.id),
    listJobPostings(role.organization.id),
    listInteractionsByClient(client.id, role.organization.id),
    listTasksByClient(client.id, role.organization.id),
    listOrganizationMembers(role.organization.id),
    listPlacementsByClient(client.id, role.organization.id),
    recordClientViewed({
      userId: user.id,
      clientRecordId: client.id,
      organizationId: client.organizationId,
    }),
    listClientAuditLog(client.id, role.organization.id),
    // 求職者の証明写真(linked 必須、未 linked は null を返す)
    (client.linkStatus === "linked" || client.linkStatus === "revoke_requested") &&
    client.linkedUserId
      ? getLinkedSeekerLatestPhoto(client.linkedUserId)
      : Promise.resolve(null),
    // LINE 紐付け 済 友達 (LINE 日程候補 提案 ボタン 表示 判定 用)
    supabase
      .from("line_user_links")
      .select("line_user_id, unfollowed_at")
      .eq("client_record_id", client.id)
      .eq("organization_id", client.organizationId)
      .maybeSingle(),
    // 副 担当 ( 共同 担当 ) 一覧
    listCollaboratorsForClient(client.id),
  ]);
  type LineLink = { line_user_id: string; unfollowed_at: string | null };
  const lineLink = (lineLinkRes.data as LineLink | null) ?? null;
  void _viewed;
  const openJobs = allJobs.filter((j) => j.status === "open");

  // 紹介の status 遷移履歴(referral_id でグルーピングされた Map)。
  // 必要な referralIds が referrals 取得結果に依存するので、Promise.all の後に直列で取得。
  // 履歴は referral_section.tsx 内の各紹介行に「選考の足跡」として表示する。
  // 同じく referral 行に表示する「最新の推薦文サマリ」もまとめて並列取得して N+1 を避ける。
  const referralIds = referrals.map((r) => r.id);
  const [historiesByReferral, latestLettersByReferral] = await Promise.all([
    listReferralStatusHistoriesByReferralIds(referralIds, role.organization.id),
    listLatestLetterSummariesByReferralIds(referralIds, role.organization.id),
  ]);

  // カスタムフィールド定義を取得(空でもセクションは描画しない条件で扱う)
  const { data: ccfdRows } = await supabase
    .from("client_custom_field_definitions")
    .select("*")
    .eq("organization_id", role.organization.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  const customFieldDefs: CustomFieldDefinition[] = (
    (ccfdRows ?? []) as Parameters<typeof rowToCustomFieldDefinition>[0][]
  ).map(rowToCustomFieldDefinition);

  // 活動タイムライン構築:対応 / タスク / 応募 / 選考遷移 / 連携状態を 1 本に統合。
  // memberNameById は履歴の actor 名解決に使う(members は別 RPC で取得済み)。
  const memberNameById = new Map<string, string | null>(
    members.map((m) => [m.memberId, m.displayName]),
  );
  const activityEvents = buildActivityTimeline({
    client,
    interactions,
    tasks,
    referrals,
    historiesByReferral,
    memberNameById,
  });

  return (
    // レイアウト編集で 2 列表示にしたときに横幅を活かせるよう、container を広めに(max-w-7xl)。
    // モバイルでは padding 由来で自然に詰まる。
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 lg:px-6">
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
        <div className="flex items-center gap-2">
          {/* email_distribution_enabled が false の場合はダイアログ内側でガード。
              現時点でもボタン自体は出して「配信停止です」のメッセージを見せる方が
              ユーザの誤解を招かない。 */}
          <ScheduleMeetingDialog clientId={client.id} clientName={client.name} />
          <ProposeMeetingButton
            lineUserId={lineLink?.line_user_id ?? null}
            unfollowed={Boolean(lineLink?.unfollowed_at)}
          />
          <SendEmailDialog
            clientId={client.id}
            clientName={client.name}
            advisorName={
              client.assignedMemberId
                ? (members.find((m) => m.memberId === client.assignedMemberId)?.displayName ?? null)
                : null
            }
            organizationName={role.organization.name}
          />
          <Button render={<Link href="/agency/clients" />} variant="outline" size="sm">
            一覧に戻る
          </Button>
        </div>
      </div>

      {/* 連携状態に応じた案内カードとアクション */}
      {client.linkStatus === "unlinked" && (
        <Card className="border-muted-foreground/20 bg-muted/30 space-y-3 p-4">
          <p className="text-sm">
            このクライアントはまだ Maira アカウントと連携していません。「連携を招待する」を押すと{" "}
            <span className="font-medium">{client.email}</span>{" "}
            に招待メールを送信します。求職者がメールから登録 + メール認証を完了すると
            自動的に連携状態になり、共有書類を閲覧できるようになります。
          </p>
          <InviteClientButton clientRecordId={client.id} />
        </Card>
      )}
      {client.linkStatus === "invited" && (
        <Card className="bg-muted/30 space-y-3 p-4">
          <p className="text-sm">
            連携招待を <span className="font-medium">{client.email}</span> に送信済みです。
            求職者が登録 + メール認証を完了するのを待っています。
          </p>
          <p className="text-muted-foreground text-xs">
            届いていない場合は再送できます(直近 5 分以内の再送はクールダウンで拒否されます)。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ResendInvitationButton clientRecordId={client.id} />
            <CancelInvitationButton clientRecordId={client.id} />
          </div>
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

      {/* 他社エージェント利用中のアラート。値が入っているときだけ表示。
          内容(復号後の文字列)は詳細フォームの「業務メモ」セクションで確認可能。
          ここでは「目立つ位置に告知」する役割に徹する。 */}
      {client.otherAgencyStatus && client.otherAgencyStatus.trim() !== "" && (
        <Card className="border-purple-200 bg-purple-50/50 p-4 dark:border-purple-900 dark:bg-purple-950/30">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-900 dark:text-purple-200">
            <AlertTriangle className="size-4" aria-hidden />
            他社エージェント利用中
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            この求職者は他社エージェントも併用中です。記録されている内容は下部の「業務メモ」
            セクションで確認できます。重複連絡・タイミング配慮に気をつけてください。
          </p>
        </Card>
      )}

      {/* 副 担当 ( 共同 担当 ) セクション。 同 組織 advisor を 1:N で 並行 共有。
          主 担当 は ClientDetailForm 側 で 編集 する 既存 動線 を 維持。 */}
      <CollaboratorsSection
        clientRecordId={client.id}
        primaryAssigneeMemberId={client.assignedMemberId ?? null}
        collaborators={collaborators.map((c) => ({
          memberId: c.memberId,
          displayName: c.displayName,
        }))}
        members={members}
        viewerMemberId={role.member.id}
        viewerRole={role.member.role}
      />

      {/* ─── タブナビ ─────────────────────────────────────────────
          URL の ?tab= に基づいてアクティブを表示。Server Component の
          <Link> ベース。JS なしでも動く。
       */}
      <div className="border-b">
        <nav
          className="-mb-px flex flex-wrap gap-1 overflow-x-auto"
          aria-label="クライアント詳細タブ"
        >
          {TABS.map((t) => {
            const isActive = t.id === activeTab;
            return (
              <Link
                key={t.id}
                href={`/agency/clients/${client.id}?tab=${t.id}`}
                className={`shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ─── タブ内容 ───────────────────────────────────────────
          各タブごとに SectionLayoutContainer を独立で持つ。
          storageKey をタブ別にすることで、並び替え設定もタブ単位で保存。
       */}
      {activeTab === "overview" && (
        <SectionLayoutContainer
          storageKey="agency-client-detail-overview"
          defaultOrder={["summary", "detail-form", "custom-fields"]}
          titles={{
            summary: "サマリ",
            "detail-form": "詳細編集",
            "custom-fields": "カスタム項目",
          }}
          sections={{
            summary: <ClientSummaryCard clientId={client.id} />,
            "detail-form": <ClientDetailForm client={client} seekerPhoto={seekerPhoto} />,
            "custom-fields": (
              <CustomFieldsSection
                clientId={client.id}
                definitions={customFieldDefs}
                initialValues={client.customFields}
              />
            ),
          }}
        />
      )}

      {activeTab === "crm" && (
        <SectionLayoutContainer
          storageKey="agency-client-detail-crm"
          defaultOrder={["timeline", "interactions", "tasks"]}
          titles={{
            timeline: "活動タイムライン",
            interactions: "対応履歴",
            tasks: "タスク",
          }}
          sections={{
            timeline: <ActivityTimelineSection events={activityEvents} />,
            interactions: (
              <InteractionsSection
                clientId={client.id}
                interactions={interactions}
                isAdmin={role.member.role === "admin"}
              />
            ),
            tasks: (
              <TasksSection
                clientId={client.id}
                tasks={tasks}
                members={members}
                currentMemberId={role.member.id}
                isAdmin={role.member.role === "admin"}
              />
            ),
          }}
        />
      )}

      {activeTab === "meetings" && (
        <SectionLayoutContainer
          storageKey="agency-client-detail-meetings"
          defaultOrder={["meetings", "hearing-sheets", "intake-upload"]}
          titles={{
            meetings: "面談履歴",
            "hearing-sheets": "ヒアリングシート",
            "intake-upload": "AI ヒアリング",
          }}
          sections={{
            meetings: <MeetingHistorySection clientRecordId={client.id} />,
            "hearing-sheets": (
              <HearingSheetsSection
                organizationId={role.organization.id}
                clientRecordId={client.id}
              />
            ),
            "intake-upload": (
              <IntakeUploadSection
                clientRecordId={client.id}
                clientLinked={client.linkStatus === "linked"}
                clientName={client.name}
              />
            ),
          }}
        />
      )}

      {activeTab === "documents" && (
        <SectionLayoutContainer
          storageKey="agency-client-detail-documents"
          defaultOrder={["agency-resumes", "agency-cvs", "documents"]}
          titles={{
            "agency-resumes": "履歴書(エージェント作成)",
            "agency-cvs": "職務経歴書(エージェント作成)",
            documents: "求職者本人提出の書類(連携時)",
          }}
          sections={{
            "agency-resumes": (
              <AgencyResumesSection
                organizationId={role.organization.id}
                clientRecordId={client.id}
                clientName={client.name}
              />
            ),
            "agency-cvs": (
              <AgencyCvsSection
                organizationId={role.organization.id}
                clientRecordId={client.id}
                clientName={client.name}
              />
            ),
            documents:
              (client.linkStatus === "linked" || client.linkStatus === "revoke_requested") &&
              client.linkedUserId ? (
                <AgencyDocumentsSection
                  linkedUserId={client.linkedUserId}
                  clientRecordId={client.id}
                />
              ) : (
                <Card className="text-muted-foreground p-6 text-sm">
                  求職者がまだ Maira と連携していないため、本人提出の書類は表示できません。
                </Card>
              ),
          }}
        />
      )}

      {activeTab === "jobs" && (
        <SectionLayoutContainer
          storageKey="agency-client-detail-jobs"
          defaultOrder={["referrals", "agency-applications", "matching", "ai-matching"]}
          titles={{
            referrals: "推薦・選考管理",
            "agency-applications": "代行応募",
            matching: "マッチング候補(ルールベース)",
            "ai-matching": "AI 求人推薦",
          }}
          sections={{
            referrals: (
              <ReferralSection
                clientId={client.id}
                referrals={referrals}
                openJobs={openJobs}
                placements={placements}
                historiesByReferral={historiesByReferral}
                latestLettersByReferral={latestLettersByReferral}
                isAdmin={role.member.role === "admin"}
              />
            ),
            "agency-applications": (
              <AgencyApplicationsSection
                organizationId={role.organization.id}
                clientRecordId={client.id}
              />
            ),
            matching: (
              <MatchingSection
                client={client}
                openJobs={openJobs}
                alreadyAppliedJobIds={referrals.map((r) => r.jobPostingId)}
              />
            ),
            "ai-matching": <AiMatchingSection clientRecordId={client.id} openJobs={openJobs} />,
          }}
        />
      )}

      {activeTab === "seeker" && (
        <SectionLayoutContainer
          storageKey="agency-client-detail-seeker"
          defaultOrder={["disclosable"]}
          titles={{
            disclosable: "求職者プロフィール",
          }}
          sections={{
            disclosable:
              (client.linkStatus === "linked" || client.linkStatus === "revoke_requested") &&
              client.linkedUserId ? (
                <DisclosableProfileSection clientRecordId={client.id} />
              ) : (
                <Card className="text-muted-foreground p-6 text-sm">
                  求職者本人がまだ Maira と連携していないため、求職者プロフィールは閲覧できません。
                </Card>
              ),
          }}
        />
      )}

      {activeTab === "audit" && (
        <SectionLayoutContainer
          storageKey="agency-client-detail-audit"
          defaultOrder={["audit"]}
          titles={{ audit: "変更履歴" }}
          sections={{ audit: <AuditLogSection entries={auditLog} /> }}
        />
      )}
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
