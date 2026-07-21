import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/queries";
import { isOnboardingCompleted } from "@/lib/onboarding/queries";
import { getPolicyAcceptance, needsToAccept } from "@/lib/privacy/policy";
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
 *
 * キャッシュ:
 *   AI 利用 残数 / 通知 / 直近 面談 等 は ユーザー の 操作 で 頻繁 に 変わる ため、
 *   force-dynamic + revalidate=0 で 毎リクエスト 最新 値 を 取得 する。
 *   (agency 側 ダッシュボード と 同じ 対応)
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  // ダッシュボードデータと onboarded_at 判定 + プライバシーポリシー同意状態 を 並行取得。
  // ポリシー未同意 の 場合、layout 側で PrivacyPolicyModal が 表示される ため、
  // ツアー自動起動 を 抑止する(同意 → router.refresh → ツアー起動 の 順番に する)。
  const [data, onboardingDone, policyAcceptance, sp] = await Promise.all([
    getDashboardData(user.id),
    isOnboardingCompleted(user.id),
    getPolicyAcceptance(user.id),
    searchParams,
  ]);

  const requirePolicy = needsToAccept(policyAcceptance);
  const replay = sp.replay === "tour";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">おかえりなさい、{data.profile.displayName}さん</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {data.status === "empty" && "Myairaへようこそ。まずはキャリア棚卸しから始めましょう"}
          {data.status === "starter" && "今日もMyairaがあなたの転職活動を伴走します"}
          {data.status === "active" && "進行中の応募とタスクを確認しましょう"}
        </p>
      </div>

      {data.status === "empty" && <DashboardEmpty upcomingMeetings={data.upcomingMeetings} />}
      {data.status === "starter" && <DashboardStarter data={data} />}
      {data.status === "active" && <DashboardActive data={data} />}

      {/* オンボーディングツアー
            ・autoStart は 「未完了」かつ 「ポリシー同意済」の 時 のみ
            ・未同意 の 場合 は layout 側 PrivacyPolicyModal が 表示中なので
              ツアー を 抑止 し、同意後 の router.refresh で 起動 させる */}
      <OnboardingTourMount autoStart={!onboardingDone && !requirePolicy} replay={replay} />
    </div>
  );
}
