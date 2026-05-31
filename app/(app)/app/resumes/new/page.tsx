import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResumeForm } from "../resume-form";

/**
 * 履歴書 新規作成画面
 *
 * 認証だけ確認して、フォーム本体に丸投げ。
 * 保存成功時はフォーム側で /app/resumes/[id] へ遷移する。
 */
export default async function NewResumePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground mb-2 text-sm">
          <Link href="/app/resumes" className="hover:underline">
            ← 履歴書一覧
          </Link>
        </p>
        <h1 className="text-2xl font-bold">新しい履歴書を作成</h1>
      </div>

      <ResumeForm mode="create" />
    </div>
  );
}
