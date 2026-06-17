import { Files } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listCvs } from "@/lib/cvs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * 職務経歴書 一覧(本人所有)
 *
 * 既存の /app/resumes(履歴書)とは別画面。
 * こちらは JIS様式 想定の構造化データ(Phase 2 でプレビュー、Phase 3 で PDF 出力予定)。
 *
 * AI下書き(Phase 4)もここから派生する想定だが、Phase 1 では純粋に
 * 「保存・編集・削除ができる土台」のみ。
 */
export default async function CvsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const cvs = await listCvs(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">職務経歴書</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          JIS様式 想定の職務経歴書を作成・管理します(プレビュー / PDF / AI下書きは順次対応)
        </p>
      </div>

      <div className="flex justify-end">
        <Button render={<Link href="/app/cvs/new" />}>+ 新しい職務経歴書を作成</Button>
      </div>

      {cvs.length === 0 ? (
        <EmptyState
          icon={<Files className="h-10 w-10" />}
          title="まだ職務経歴書がありません"
          description="「+ 新しい職務経歴書を作成」ボタンから登録できます"
        />
      ) : (
        <div className="space-y-3">
          {cvs.map((cv) => (
            <Card key={cv.id} className="p-4">
              <Link href={`/app/cvs/${cv.id}`} className="block hover:opacity-80">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{cv.title}</p>
                    {cv.body.summary && (
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                        {cv.body.summary}
                      </p>
                    )}
                    <p className="text-muted-foreground mt-1 text-xs">
                      更新日:{new Date(cv.updatedAt).toLocaleString("ja-JP")}
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
