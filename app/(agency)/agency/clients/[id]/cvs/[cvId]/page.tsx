import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { CvPreview } from "@/components/features/cv/cv-preview";
import { getClientRecord } from "@/lib/clients/queries";
import { getCv } from "@/lib/cvs/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { getResume } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * エージェント向け 職務経歴書 閲覧ページ(read-only)
 *
 * 認可:
 *   1. ログイン中ユーザーが organization_member であること
 *   2. URL の clientRecordId が自組織のクライアントであり、linked であること
 *   3. cv の所有者が client_records.linked_user_id と一致すること
 *   4. 上記をすべて満たさなければ notFound() に倒す
 *
 *   DB レベルでは Phase 4 の RLS で 1〜3 が再度ガードされるが、コード側でも明示
 *   確認する(防御的、resumes 向けページと同型)。
 *
 * 履歴書からの引き当て:
 *   CvPreview は氏名・資格を履歴書(license_resume_id)から引いて描画する。本人側の
 *   getCvWithLinkedResume と同じく、license_resume_id がある場合は getResume を
 *   呼んで氏名・資格を渡す。getResume も linked クライアントの linkedUserId を
 *   渡せば RLS が通る。
 */

type PageProps = {
  params: Promise<{ id: string; cvId: string }>;
};

export default async function AgencyCvViewPage({ params }: PageProps) {
  const { id: clientRecordId, cvId } = await params;

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

  const cv = await getCv(cvId, client.linkedUserId);
  if (!cv) notFound();

  // 履歴書参照(本人側 cv-tabs と同型)。license_resume_id が null か
  // 履歴書が存在しなければ氏名・資格は空にフォールバック。
  const linkedResume = cv.licenseResumeId
    ? await getResume(cv.licenseResumeId, client.linkedUserId)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm">
            <Link href={`/agency/clients/${clientRecordId}`} className="hover:underline">
              ← クライアント詳細に戻る
            </Link>
          </p>
          <h1 className="text-2xl font-bold">{cv.title}</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {client.name} さんが共有した職務経歴書(閲覧のみ)
          </p>
        </div>
      </div>

      <Card className="bg-muted/20 p-3">
        <p className="text-muted-foreground text-xs">
          このページは閲覧専用です。書類の編集はできません。
        </p>
      </Card>

      <CvPreview
        body={cv.body}
        name={linkedResume?.name ?? null}
        licenses={linkedResume?.licenses ?? []}
        documentDate={cv.documentDate}
      />
    </div>
  );
}
