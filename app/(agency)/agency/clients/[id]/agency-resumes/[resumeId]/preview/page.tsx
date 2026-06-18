import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ResumePreview } from "@/components/features/resume/resume-preview";
import { agencyClientResumeToSeekerResume } from "@/lib/agency-client-documents/agency-resume-mapper";
import {
  AGENCY_PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC,
  createAgencyClientPhotoSignedUrl,
} from "@/lib/agency-client-documents/photo-signed-url";
import { getAgencyClientResume } from "@/lib/agency-client-documents/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * /agency/clients/[id]/agency-resumes/[resumeId]/preview
 *
 * エージェント所有の履歴書を厚労省様式の HTML プレビューで表示する。
 * 既存の <ResumePreview>(seeker 用)を、マッピング後の Resume 型で再利用。
 *
 * 認可:
 *   ・組織メンバー(getUserRole)
 *   ・client_record の organization_id 一致
 *   ・履歴書の organization_id 一致 + client_record_id 一致
 */
type RouteParams = {
  params: Promise<{ id: string; resumeId: string }>;
};

export default async function AgencyResumePreviewPage({ params }: RouteParams) {
  const { id: clientRecordId, resumeId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const client = await getClientRecord(clientRecordId);
  if (!client || client.organizationId !== role.organization.id) notFound();

  const resume = await getAgencyClientResume(resumeId, role.organization.id);
  if (!resume || resume.clientRecordId !== clientRecordId) notFound();

  // 写真の署名 URL は組織用バケットから発行(プレビューは 60 分有効)
  const photoSignedUrl = resume.photoStoragePath
    ? await createAgencyClientPhotoSignedUrl(
        resume.photoStoragePath,
        AGENCY_PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC,
      )
    : null;

  const seekerResume = agencyClientResumeToSeekerResume(resume);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">
            <Link
              href={`/agency/clients/${clientRecordId}/agency-resumes/${resumeId}`}
              className="hover:underline"
            >
              ← 編集に戻る
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-bold">{resume.title}(プレビュー)</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {client.name} さん向け / 厚労省様式 / A4 縦
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <a href={`/api/agency/client-resumes/${resumeId}/pdf`} download>
                PDF をダウンロード
              </a>
            }
          />
          <Button
            size="sm"
            render={
              <Link href={`/agency/clients/${clientRecordId}/agency-resumes/${resumeId}`}>
                編集へ戻る
              </Link>
            }
          />
        </div>
      </div>

      <Card className="bg-muted/20 p-3">
        <p className="text-muted-foreground text-xs">
          このプレビューはブラウザ表示用です。実際の印刷物に近い見た目を確認するには「PDF
          をダウンロード」をご利用ください。
        </p>
      </Card>

      <ResumePreview resume={seekerResume} photoSignedUrl={photoSignedUrl} />
    </div>
  );
}
