import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCareerProfile } from "@/lib/career/conversations";
import {
  documentTypeDescriptions,
  documentTypeLabels,
  documentTypes,
  requiresJobInfo,
} from "@/lib/documents/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 書類タイプ選択画面
 *
 * career_profile がない状態でこのページに直接来た場合は一覧へ戻す
 * (一覧ではキャリア棚卸しへの誘導を出す)。
 */
export default async function NewDocumentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profileData = await getCareerProfile(user.id);
  if (!profileData) {
    redirect("/app/documents");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">書類タイプを選ぶ</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            志望動機または自己PRを選択してください
          </p>
        </div>
        <Button render={<Link href="/app/documents" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {documentTypes.map((type) => (
          <Card key={type} className="p-0">
            <Link
              href={`/app/documents/new/${type}`}
              className="hover:bg-accent block p-6 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium">{documentTypeLabels[type]}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {documentTypeDescriptions[type]}
                  </p>
                  {requiresJobInfo(type) && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      ※求人情報の入力が必要
                    </p>
                  )}
                </div>
                <span className="text-muted-foreground text-sm">→</span>
              </div>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
