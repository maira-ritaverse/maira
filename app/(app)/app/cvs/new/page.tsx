import Link from "next/link";
import { redirect } from "next/navigation";
import { getCareerProfile } from "@/lib/career/conversations";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { CvForm } from "../cv-form";

/**
 * 職務経歴書 新規作成画面
 *
 * 認証チェックして、フォーム本体に丸投げ。保存成功時はフォーム側で /app/cvs/[id] へ遷移。
 *
 * 履歴書(resumes)の一覧をここで取得して渡す:CV の「資格欄」は
 * 履歴書(licenses)を参照する設計のため、フォームで「どの履歴書を引くか」を
 * 選ぶ dropdown に必要。
 */
export default async function NewCvPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // career_profile も並列で読む(AI ボタン有効化判定に使う、Phase 4-c〜)。
  const [resumes, careerProfile] = await Promise.all([
    listResumes(user.id),
    getCareerProfile(user.id),
  ]);
  const resumeOptions = resumes.map((r) => ({ id: r.id, title: r.title }));
  const hasCareerProfile = careerProfile !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground mb-2 text-sm">
          <Link href="/app/cvs" className="hover:underline">
            ← 職務経歴書一覧
          </Link>
        </p>
        <h1 className="text-2xl font-bold">新しい職務経歴書を作成</h1>
      </div>

      <CvForm mode="create" resumeOptions={resumeOptions} hasCareerProfile={hasCareerProfile} />
    </div>
  );
}
