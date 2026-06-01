import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { axisQuestions } from "@/lib/diagnosis/axis-questions";
import { aptitudeQuestions } from "@/lib/diagnosis/aptitude-questions";

/**
 * キャリア診断:入口ページ
 *
 * - 「キャリアの軸」と「適性」の2つの診断を受けると、向いている職種カテゴリを
 *   候補として提示する機能の入口。
 * - このページは結果やプロフィールへの依存がないため、Server Component で
 *   ログインだけ確認して静的な説明を返す。
 * - 設問数(26 = 16 + 10)はソースから derive する。設問が増減したときに
 *   表示文言が乖離しないように、設定値ではなくデータ長を参照する。
 */
export default async function DiagnosisIntroPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const totalQuestions = axisQuestions.length + aptitudeQuestions.length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">キャリア診断</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          自分の「軸」と「強み」を見つけ、向いている仕事の方向性を発見します
        </p>
      </div>

      <Card className="space-y-5 p-6">
        <div>
          <p className="text-sm font-medium">この診断でわかること</p>
          <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
            <li>・ あなたが大切にしている「キャリアの軸」</li>
            <li>・ あなたの「強み」(発想力・継続力・対人力など)</li>
            <li>・ 向いている職種カテゴリの候補</li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium">流れ</p>
          <ol className="text-muted-foreground mt-2 space-y-1 text-sm">
            <li>1. キャリアの軸を測る設問({axisQuestions.length}問)</li>
            <li>2. あなたの強みを測る設問({aptitudeQuestions.length}問)</li>
            <li>3. 結果と職種候補を確認</li>
          </ol>
          <p className="text-muted-foreground mt-3 text-xs">目安: 5〜7分 / 全{totalQuestions}問</p>
        </div>

        <div className="bg-muted/50 rounded-md p-3">
          <p className="text-muted-foreground text-xs leading-relaxed">
            正解・不正解はありません。直感で答えるほど、結果が正確になります。
            提示される職種は「向いている方向の候補」であり、可能性を狭めるものではありません。
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button render={<Link href="/app/diagnosis/take" />}>診断を始める</Button>
      </div>
    </div>
  );
}
