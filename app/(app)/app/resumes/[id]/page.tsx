import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCareerProfile } from "@/lib/career/conversations";
import { getResume } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { ResumeTabs } from "./resume-tabs";

/**
 * 履歴書 詳細画面(編集 / プレビュー切り替え)
 *
 * 認証 + 所有チェック(getResume が他人 or 存在しないときは null)。
 * career_profile の有無もここで取得し、ResumeTabs → ResumeForm へ
 * 受け渡してAI下書き生成ボタンの有効/無効判定に使う。
 */
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditResumePage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const [resume, careerProfile] = await Promise.all([
    getResume(id, user.id),
    getCareerProfile(user.id),
  ]);
  if (!resume) notFound();

  const hasCareerProfile = careerProfile !== null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-muted-foreground mb-2 text-sm">
          <Link href="/app/resumes" className="hover:underline">
            ← 履歴書一覧
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{resume.title}</h1>
      </div>

      <ResumeTabs resume={resume} hasCareerProfile={hasCareerProfile} />
    </div>
  );
}
