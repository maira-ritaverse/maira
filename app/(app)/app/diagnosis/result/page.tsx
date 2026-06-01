import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DiagnosisResultView } from "@/components/features/diagnosis/diagnosis-result-view";
import { getCareerProfile } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * 診断結果ページ(Server Component)
 *
 * career_profile に保存された diagnosis を読んで表示する。
 * - 結果はサーバーで render。リロードや別タブで再訪可能(共有しやすい)。
 * - 診断未実施で訪れた場合は、入口に戻す。
 */
export default async function DiagnosisResultPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const profileData = await getCareerProfile(user.id);
  const diagnosis = profileData?.profile.diagnosis;

  if (!diagnosis) {
    // 診断未実施。入口に戻す代わりに、軽い案内を出して入口導線を見せる。
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">キャリア診断 結果</h1>
        <Card className="space-y-3 p-6 text-center">
          <p className="text-muted-foreground text-sm">まだ診断を受けていません</p>
          <div className="flex justify-center pt-2">
            <Button render={<Link href="/app/diagnosis" />}>診断を受ける</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">あなたのキャリア診断</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            軸・強み・向いている職種を発見しました
          </p>
        </div>
      </div>

      <DiagnosisResultView diagnosis={diagnosis} />

      {/* 次のアクションへの導線 */}
      <Card className="space-y-3 p-6">
        <p className="text-sm font-medium">この結果を活かす</p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          診断結果は、キャリア棚卸しの対話や書類作成にも活かせます。
          深掘りしたい場合は棚卸しへ進みましょう。
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" render={<Link href="/app/career" />}>
            キャリア棚卸しへ
          </Button>
          <Button variant="outline" render={<Link href="/app/documents" />}>
            書類作成へ
          </Button>
          <Button variant="ghost" render={<Link href="/app/diagnosis/take" />}>
            もう一度診断する
          </Button>
        </div>
      </Card>
    </div>
  );
}
