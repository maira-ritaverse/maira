import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/queries";
import { DashboardEmpty } from "./dashboard-empty";
import { DashboardStarter } from "./dashboard-starter";
import { DashboardActive } from "./dashboard-active";

/**
 * ダッシュボード(認証後の入口)。
 *
 * Server Component で全モジュールのデータを並行取得し、利用状況に応じて
 * 3 つの状態別コンポーネント(empty / starter / active)を出し分ける。
 * layout.tsx 側でも未認証ガードはしているが、user.id を直接使うため
 * ここでも明示的に取得する(防御的)。
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const data = await getDashboardData(user.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
    </div>
  );
}
