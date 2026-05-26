import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCareerProfile, listCareerConversations } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * キャリア棚卸し:過去会話一覧 + 新規開始ボタン
 *
 * 暗号化タイトルは Week 3 で本実装するため、ここでは固定文言「キャリア棚卸し」と
 * メタデータ(メッセージ数 / 最終更新日時)だけを表示する。
 */
export default async function CareerListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const conversations = await listCareerConversations(user.id);
  const profileData = await getCareerProfile(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">キャリア棚卸し</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          雑談感覚であなたの強みや価値観を整理します
        </p>
      </div>

      {profileData && (
        <Card className="border-primary/40 bg-primary/5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                現在の棚卸し結果(v{profileData.version})
              </p>
              <p className="text-sm leading-relaxed">{profileData.profile.summary}</p>
              <p className="text-muted-foreground mt-3 text-xs">
                最終更新: {new Date(profileData.updatedAt).toLocaleString("ja-JP")} ・ 強み{" "}
                {profileData.profile.strengths.length}個
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button render={<Link href="/app/career/new" />}>新しく棚卸しを始める</Button>
      </div>

      {conversations.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-lg">まだ棚卸し履歴がありません</p>
          <p className="text-muted-foreground mt-2 text-sm">
            「新しく棚卸しを始める」ボタンから始められます
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => (
            <Card key={conv.id} className="p-4">
              <Link href={`/app/career/${conv.id}`} className="block hover:opacity-80">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">キャリア棚卸し</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {conv.message_count}件のメッセージ ・ 最終更新:
                      {new Date(conv.last_message_at).toLocaleString("ja-JP")}
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
