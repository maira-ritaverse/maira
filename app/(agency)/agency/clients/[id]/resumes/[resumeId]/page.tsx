import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ResumePreview } from "@/components/features/resume/resume-preview";
import { getClientRecord } from "@/lib/clients/queries";
import { getUserRole } from "@/lib/organizations/queries";
import {
  createResumePhotoSignedUrl,
  PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC,
} from "@/lib/resumes/photo-signed-url";
import { getResume } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * エージェント向け 履歴書 閲覧ページ(read-only)
 *
 * 認可:
 *   1. ログイン中ユーザーが organization_member であること
 *   2. URL の clientRecordId が自組織のクライアントであり、linked であること
 *   3. resume の所有者が client_records.linked_user_id と一致すること
 *   4. 上記をすべて満たさなければ notFound() に倒す
 *
 *   DB レベルでは Phase 4 の RLS(20260607000007)で 1〜3 が再度ガードされるが、
 *   コード側でも明示確認する(防御的)。
 *
 * 表示:
 *   本人側の ResumePreview コンポーネントを再利用する。フォーム編集機能は持たない
 *   (resumes に INSERT/UPDATE/DELETE のエージェント向けポリシーは追加していない
 *   ため、書き込もうとしても RLS で弾かれる)。
 *
 * 写真:
 *   本人側と同じく署名付き URL を作成する。Storage の RLS は本人限定だが、
 *   エージェント側で署名URLが発行できるかは別途要検証。発行に失敗したら写真欄を
 *   プレースホルダにフォールバックする(ResumePreview の photoSignedUrl=null 経路)。
 */

type PageProps = {
  params: Promise<{ id: string; resumeId: string }>;
};

export default async function AgencyResumeViewPage({ params }: PageProps) {
  const { id: clientRecordId, resumeId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const client = await getClientRecord(clientRecordId);
  if (
    !client ||
    client.organizationId !== role.organization.id ||
    client.linkStatus !== "linked" ||
    !client.linkedUserId
  ) {
    notFound();
  }

  // RLS が「linked かつ自組織」を保証するが、コード側でも linkedUserId を渡し
  // user_id 等価フィルタを通過することで二重防御にする。
  const resume = await getResume(resumeId, client.linkedUserId);
  if (!resume) notFound();

  // 写真の署名URL発行は失敗しても全体は壊さない(プレースホルダにフォールバック)。
  let photoSignedUrl: string | null = null;
  if (resume.photoUrl) {
    try {
      photoSignedUrl = await createResumePhotoSignedUrl(
        resume.photoUrl,
        PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC,
      );
    } catch {
      photoSignedUrl = null;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm">
            <Link href={`/agency/clients/${clientRecordId}`} className="hover:underline">
              ← クライアント詳細に戻る
            </Link>
          </p>
          <h1 className="text-2xl font-bold">{resume.title}</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {client.name} さんが共有した履歴書(閲覧のみ)
          </p>
        </div>
      </div>

      <Card className="bg-muted/20 p-3">
        <p className="text-muted-foreground text-xs">
          このページは閲覧専用です。書類の編集はできません。
        </p>
      </Card>

      <ResumePreview resume={resume} photoSignedUrl={photoSignedUrl} />
    </div>
  );
}
