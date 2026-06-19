import { FileText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { checkAiUsageLimit } from "@/lib/features/ai-usage";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";

import { DuplicateResumeButton } from "./duplicate-resume-button";

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

  const [resumes, usage] = await Promise.all([
    listResumes(user.id),
    checkAiUsageLimit(supabase, user.id, "seeker_resume_create"),
  ]);
  const remaining = Math.max(0, usage.limit - usage.current);
  const canCreate = remaining > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">履歴書</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          厚労省推奨様式に沿った履歴書を作成・管理します(PDF出力は今後対応)
        </p>
      </div>

      {/* 残数表示 + 新規作成 / 複製 ボタン */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-muted-foreground text-xs">今月の 新規作成 枠</p>
          <p className="text-lg font-semibold">
            残 <span className={canCreate ? "text-foreground" : "text-red-600"}>{remaining}</span>
            <span className="text-muted-foreground text-sm"> / {usage.limit} 件</span>
          </p>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            複製は カウント されません ・ 翌月 1 日 リセット
          </p>
        </div>
        <div className="flex gap-2">
          <DuplicateResumeButton resumes={resumes.map((r) => ({ id: r.id, title: r.title }))} />
          {canCreate ? (
            <Button render={<Link href="/app/resumes/new" />}>+ 新しい履歴書 を作成</Button>
          ) : (
            <Button disabled title="今月の 作成枠 を 使い切りました">
              + 新しい履歴書 を作成
            </Button>
          )}
        </div>
      </Card>

      {!canCreate && (
        <Card className="border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          今月の 新規作成 枠 ({usage.limit} 件) を 使い切りました。 翌月 1 日 に リセット されます。
          既存 履歴書 の 「複製」 は 引き続き 可能です (複製は 月次枠 を 消費 しません)。
        </Card>
      )}

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
