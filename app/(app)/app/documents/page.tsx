import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getCareerProfile } from "@/lib/career/conversations";
import { listDocumentConversations } from "@/lib/documents/conversations";
import { documentTypeLabels, type DocumentType } from "@/lib/documents/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 書類作成:過去書類の一覧 + 新規作成ボタン
 *
 * career_profile が未生成の場合は、書類作成を始められない旨を表示し、
 * キャリア棚卸しへ誘導する(書類は棚卸し結果を入力にするため必須)。
 */
export default async function DocumentsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // 一覧と棚卸し結果有無は独立して取得できるので並列化
  const [documents, profileData] = await Promise.all([
    listDocumentConversations(user.id),
    getCareerProfile(user.id),
  ]);

  const hasProfile = profileData !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">書類作成</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          履歴書・職務経歴書・志望動機・自己PRをAIが生成します
        </p>
      </div>

      {!hasProfile && (
        <Alert>
          <AlertDescription>
            書類作成を始める前に、キャリア棚卸しを完了させてください。
            <Link href="/app/career" className="ml-2 font-medium underline">
              キャリア棚卸しへ
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        {hasProfile ? (
          <Button render={<Link href="/app/documents/new" />}>新しく書類を作る</Button>
        ) : (
          <Button disabled>新しく書類を作る</Button>
        )}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon="📝"
          title="まだ書類がありません"
          description={
            hasProfile
              ? "「新しく書類を作る」ボタンから生成できます"
              : "キャリア棚卸しを完了させると書類を作成できます"
          }
        />
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            // metadata は jsonb なので型は unknown。明示的にキャストする。
            const metadata = (doc.metadata ?? {}) as {
              document_type?: DocumentType;
              job_info_preview?: string;
            };
            const docType = metadata.document_type;
            const typeLabel = docType ? documentTypeLabels[docType] : "書類";

            return (
              <Card key={doc.id} className="p-4">
                <Link href={`/app/documents/${doc.id}`} className="block hover:opacity-80">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{typeLabel}</p>
                      {metadata.job_info_preview && (
                        <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                          求人:{metadata.job_info_preview}
                        </p>
                      )}
                      <p className="text-muted-foreground mt-1 text-xs">
                        作成日:{new Date(doc.created_at).toLocaleString("ja-JP")}
                      </p>
                    </div>
                    <span className="text-muted-foreground text-sm">→</span>
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
