import { Files } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listCvs } from "@/lib/cvs/queries";
import { checkAiUsageLimit } from "@/lib/features/ai-usage";
import { createClient } from "@/lib/supabase/server";

import { DuplicateCvButton } from "./duplicate-cv-button";

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

  const [cvs, usage] = await Promise.all([
    listCvs(user.id),
    checkAiUsageLimit(supabase, user.id, "seeker_cv_create"),
  ]);
  const remaining = Math.max(0, usage.limit - usage.current);
  const canCreate = remaining > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">職務経歴書</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          JIS様式 想定の職務経歴書を作成・管理します(プレビュー / PDF / AI下書きは順次対応)
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
          <DuplicateCvButton cvs={cvs.map((c) => ({ id: c.id, title: c.title }))} />
          {canCreate ? (
            <Button render={<Link href="/app/cvs/new" />}>+ 新しい職務経歴書 を作成</Button>
          ) : (
            <Button disabled title="今月の 作成枠 を 使い切りました">
              + 新しい職務経歴書 を作成
            </Button>
          )}
        </div>
      </Card>

      {!canCreate && (
        <Card className="border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          今月の 新規作成 枠 ({usage.limit} 件) を 使い切りました。 翌月 1 日 に リセット されます。
          既存 職務経歴書 の 「複製」 は 引き続き 可能です (複製は 月次枠 を 消費 しません)。
        </Card>
      )}

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
