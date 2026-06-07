import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCareerProfile } from "@/lib/career/conversations";
import { getCv } from "@/lib/cvs/queries";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { CvTabs } from "./cv-tabs";

/**
 * 職務経歴書 詳細画面(編集 / プレビュー切替)
 *
 * Phase 2-b で完成:
 *   - 編集/プレビューのタブ切替(履歴書 resume-tabs と同型)
 *   - 履歴書(license_resume_id)から氏名・資格を解決してプレビューに反映
 *
 * 履歴書の解決方法:
 *   - listResumes() で取得した結果(license dropdown 用にどのみち全件読む)から
 *     cv.licenseResumeId で find するだけ。再フェッチ不要、復号も 1 度で済む。
 *   - 履歴書未選択 / 参照先が見つからない場合は null / [] を渡し、
 *     プレビュー側で「履歴書を選択すると〜」の案内文を出す。
 *
 * Phase 3 で PDF、Phase 4 で AI下書きを足す。
 *
 * getCv は本人かつ存在するもののみ返す(RLS + 明示クエリの二重保護)。
 */
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCvPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // career_profile も並列で読む(AI ボタン有効化判定に使う、Phase 4-c〜)。
  // 履歴書 [id]/page.tsx と同型の取り回し。
  const [cv, resumes, careerProfile] = await Promise.all([
    getCv(id, user.id),
    listResumes(user.id),
    getCareerProfile(user.id),
  ]);
  if (!cv) notFound();

  const resumeOptions = resumes.map((r) => ({ id: r.id, title: r.title }));
  const hasCareerProfile = careerProfile !== null;

  // 履歴書参照解決:listResumes の結果を再利用するだけなので追加コストなし。
  // 履歴書が削除済みなら on delete set null で licenseResumeId が null になるが、
  // 念のため find が undefined を返した場合も null/[] にフォールバックする。
  const linkedResume = cv.licenseResumeId
    ? (resumes.find((r) => r.id === cv.licenseResumeId) ?? null)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-muted-foreground mb-2 text-sm">
          <Link href="/app/cvs" className="hover:underline">
            ← 職務経歴書一覧
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{cv.title}</h1>
      </div>

      <CvTabs
        cv={cv}
        resumeOptions={resumeOptions}
        linkedResumeName={linkedResume?.name ?? null}
        linkedResumeLicenses={linkedResume?.licenses ?? []}
        hasCareerProfile={hasCareerProfile}
      />
    </div>
  );
}
