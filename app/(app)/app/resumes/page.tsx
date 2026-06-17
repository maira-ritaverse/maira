import { FileText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * 履歴書一覧(本人所有)
 *
 * 既存の /app/documents(AI生成テキスト)とは別の画面。
 * こちらは構造化データの履歴書(将来 PDF 出力する想定)。
 */
export default async function ResumesListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const resumes = await listResumes(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">履歴書</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          厚労省推奨様式に沿った履歴書を作成・管理します(PDF出力は今後対応)
        </p>
      </div>

      <div className="flex justify-end">
        <Button render={<Link href="/app/resumes/new" />}>+ 新しい履歴書を作成</Button>
      </div>

      {resumes.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="まだ履歴書がありません"
          description="「+ 新しい履歴書を作成」ボタンから登録できます"
        />
      ) : (
        <div className="space-y-3">
          {resumes.map((resume) => (
            <Card key={resume.id} className="p-4">
              <Link href={`/app/resumes/${resume.id}`} className="block hover:opacity-80">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{resume.title}</p>
                    {resume.name && (
                      <p className="text-muted-foreground mt-1 text-sm">氏名:{resume.name}</p>
                    )}
                    <p className="text-muted-foreground mt-1 text-xs">
                      更新日:{new Date(resume.updatedAt).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-sm">→</span>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
