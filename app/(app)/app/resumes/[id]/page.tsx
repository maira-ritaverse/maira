import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getResume } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { ResumeTabs } from "./resume-tabs";

/**
 * 履歴書 詳細画面(編集 / プレビュー切り替え)
 *
 * 認証 + 所有チェック(getResume が他人 or 存在しないときは null)。
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

  const resume = await getResume(id, user.id);
  if (!resume) notFound();

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

      <ResumeTabs resume={resume} />
    </div>
  );
}
