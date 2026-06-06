import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCv } from "@/lib/cvs/queries";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { CvForm } from "../cv-form";

/**
 * 職務経歴書 詳細画面(編集モード)
 *
 * Phase 1 ではプレビュー切替は無し。編集フォームのみ。
 * Phase 2 でプレビュー、Phase 3 で PDF、Phase 4 で AI下書きを足す。
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

  const [cv, resumes] = await Promise.all([getCv(id, user.id), listResumes(user.id)]);
  if (!cv) notFound();

  const resumeOptions = resumes.map((r) => ({ id: r.id, title: r.title }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground mb-2 text-sm">
          <Link href="/app/cvs" className="hover:underline">
            ← 職務経歴書一覧
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{cv.title}</h1>
      </div>

      <CvForm mode="edit" existing={cv} resumeOptions={resumeOptions} />
    </div>
  );
}
