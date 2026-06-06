import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CvPreview } from "@/components/features/cv/cv-preview";
import { getCv } from "@/lib/cvs/queries";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { CvForm } from "../cv-form";

/**
 * 職務経歴書 詳細画面(編集モード)
 *
 * Phase 2-a:暫定的にプレビューをフォーム下に並べて見た目を確認できるようにする。
 *   - 氏名・資格は履歴書からの参照接続が Phase 2-b 待ちのため、ここでは
 *     name=null / licenses=[] を渡してプレビューが崩れないことを優先する
 *   - 編集/プレビューのタブ切替は Phase 2-b で実装(履歴書 resume-tabs と同型)
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

  const [cv, resumes] = await Promise.all([getCv(id, user.id), listResumes(user.id)]);
  if (!cv) notFound();

  const resumeOptions = resumes.map((r) => ({ id: r.id, title: r.title }));

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

      <CvForm mode="edit" existing={cv} resumeOptions={resumeOptions} />

      {/* Phase 2-a 暫定表示:プレビューをフォーム下に並べる。
          Phase 2-b で履歴書からの氏名・資格を本接続し、編集/プレビューの
          タブ切替を導入する(現状はタブ無しで両方常時表示)。 */}
      <div className="border-t pt-6">
        <p className="text-muted-foreground mb-4 text-sm">
          ↓ プレビュー(Phase 2-a 暫定表示。保存後の内容を反映。氏名・資格は Phase 2-b
          で履歴書から本接続)
        </p>
        <CvPreview body={cv.body} name={null} licenses={[]} documentDate={cv.documentDate} />
      </div>
    </div>
  );
}
