import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { RecommendedJobsClient } from "./recommended-jobs-client";

/**
 * 求職者向け AI 求人推薦ページ(/app/recommended-jobs)
 *
 * - 連携エージェンシーが open にしている求人から、キャリア棚卸し + 診断結果に
 *   基づいて Claude が TOP 5 をランキング
 * - 推薦結果は API 側で動的計算(都度 Claude 呼出)
 * - 棚卸しの更新が即時反映されるよう、ページにキャッシュは置かない
 */
export default async function RecommendedJobsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/app" className="hover:underline">
            ← ダッシュボード
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">あなたへの AI 求人推薦</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          連携エージェンシーが扱う求人のなかから、キャリア棚卸しと診断結果に基づいて AI
          がマッチ度の高い順に並べます。
        </p>
      </div>

      <RecommendedJobsClient />
    </div>
  );
}
