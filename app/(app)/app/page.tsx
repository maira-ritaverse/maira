import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/queries";
import { isOnboardingCompleted } from "@/lib/onboarding/queries";
import { DashboardEmpty } from "./dashboard-empty";
import { DashboardStarter } from "./dashboard-starter";
import { DashboardActive } from "./dashboard-active";
import { OnboardingTourMount } from "@/components/features/onboarding/onboarding-tour-mount";

/**
 * ダッシュボード(認証後の入口)。
 *
 * Server Component で全モジュールのデータを並行取得し、利用状況に応じて
 * 3 つの状態別コンポーネント(empty / starter / active)を出し分ける。
 * layout.tsx 側でも未認証ガードはしているが、user.id を直接使うため
 * ここでも明示的に取得する(防御的)。
 *
 * 併せて、オンボーディングツアーの完了状態も取得し、未完了なら
 * ツアーを自動起動する(OnboardingTourMount に autoStart で渡す)。
 * 再表示ボタンからは /app?replay=tour で遷移してくるため、searchParams を
 * 読んで replay フラグも渡す。
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ replay?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // ダッシュボードデータと onboarded_at 判定を並行取得。
  // それぞれ独立した SELECT なので待ち時間を圧縮する。
  const [data, onboardingDone, sp] = await Promise.all([
    getDashboardData(user.id),
    isOnboardingCompleted(user.id),
    searchParams,
  ]);

  const replay = sp.replay === "tour";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">おかえりなさい、{data.profile.displayName}さん</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {data.status === "empty" && "Mairaへようこそ。まずはキャリア棚卸しから始めましょう"}
          {data.status === "starter" && "今日もMairaがあなたの転職活動を伴走します"}
          {data.status === "active" && "進行中の応募とタスクを確認しましょう"}
        </p>
      </div>

      {data.status === "empty" && <DashboardEmpty />}
      {data.status === "starter" && <DashboardStarter data={data} />}
      {data.status === "active" && <DashboardActive data={data} />}

      {/* オンボーディングツアー(未完了の時の自動起動 + 再表示クエリでの強制起動) */}
      <OnboardingTourMount autoStart={!onboardingDone} replay={replay} />
    </div>
  );
}
