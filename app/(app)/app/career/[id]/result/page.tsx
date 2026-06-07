import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CareerProfileDisplay } from "@/components/features/career-profile-display";
import { CareerRediagnoseButton } from "@/components/features/career-rediagnose-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCareerProfile, verifyConversationOwner } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * キャリア棚卸し結果ページ
 *
 * 注:現状は user 単位で1レコードのみ保持。conversationId と結果は紐付けていない。
 * URL の [id] は「どの会話画面から飛んできたか」のコンテキスト用で、
 * 表示する結果は常にそのユーザーの最新版。
 */
export default async function CareerResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const isOwner = await verifyConversationOwner(id, user.id);
  if (!isOwner) notFound();

  const profileData = await getCareerProfile(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">キャリア棚卸し結果</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            会話から抽出された、あなたの強みと希望
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 編集 / 再診断 ともに profile があるときのみ表示。
              無い場合は「結果がまだ無い」ので操作対象が無く意味がない。 */}
          {profileData && (
            <>
              <Button render={<Link href="/app/career/edit" />} variant="outline" size="sm">
                編集
              </Button>
              <CareerRediagnoseButton />
            </>
          )}
          <Button render={<Link href={`/app/career/${id}`} />} variant="outline" size="sm">
            会話に戻る
          </Button>
        </div>
      </div>

      {profileData ? (
        <CareerProfileDisplay
          profile={profileData.profile}
          updatedAt={profileData.updatedAt}
          version={profileData.version}
        />
      ) : (
        <Card className="p-12 text-center">
          <p className="text-lg">まだ結果が生成されていません</p>
          <p className="text-muted-foreground mt-2 text-sm">
            会話画面の「結果を生成」ボタンから生成できます
          </p>
        </Card>
      )}
    </div>
  );
}
