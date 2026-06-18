import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  AGENCY_PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC,
  createAgencyClientPhotoSignedUrl,
} from "@/lib/agency-client-documents/photo-signed-url";
import { getAgencyClientResume } from "@/lib/agency-client-documents/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { AgencyResumeEditor } from "./agency-resume-editor";
import { AgencyResumePhoto } from "./agency-resume-photo";

/**
 * /agency/clients/[id]/agency-resumes/[resumeId]
 *
 * エージェント所有の履歴書 1 件の編集画面。
 *
 * パスを /resumes/[id] と分けた理由:
 *   ・/agency/clients/[id]/resumes/[id] は seeker 所有の resume を agency が
 *     read-only で閲覧する既存の画面(linked 時のみ)。エージェント所有とは
 *     データソースが別なので、URL 空間を分離する。
 *
 * 認可:
 *   ・組織メンバー
 *   ・client_record の organization_id 一致
 *   ・resume の client_record_id 一致 + organization_id 一致
 */
type RouteParams = {
  params: Promise<{ id: string; resumeId: string }>;
};

export default async function AgencyResumeEditPage({ params }: RouteParams) {
  const { id: clientRecordId, resumeId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const client = await getClientRecord(clientRecordId);
  if (!client || client.organizationId !== role.organization.id) {
    notFound();
  }

  const resume = await getAgencyClientResume(resumeId, role.organization.id);
  if (!resume || resume.clientRecordId !== clientRecordId) {
    notFound();
  }

  // 写真の署名 URL は SSR で発行(エージェントセッションで Storage RLS を通す)。
  // 発行失敗時はプレースホルダにフォールバック。
  let photoSignedUrl: string | null = null;
  if (resume.photoStoragePath) {
    photoSignedUrl = await createAgencyClientPhotoSignedUrl(
      resume.photoStoragePath,
      AGENCY_PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC,
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">
            <Link
              href={`/agency/clients/${clientRecordId}?tab=documents`}
              className="hover:underline"
            >
              ← {client.name} さんの書類
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-bold">履歴書を編集</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/agency/clients/${clientRecordId}?tab=documents`} />}
        >
          一覧へ戻る
        </Button>
      </div>

      <AgencyResumePhoto
        resumeId={resume.id}
        initialPreviewUrl={photoSignedUrl}
        hasPhoto={resume.photoStoragePath !== null}
      />

      <AgencyResumeEditor
        clientRecordId={clientRecordId}
        resume={resume}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
