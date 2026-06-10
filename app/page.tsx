import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { Button } from "@/components/ui/button";

/**
 * トップページ
 *
 * - 未ログイン:そのままページ内容を表示(将来 LP に差し替え予定)
 * - ログイン済み:account_type に応じてダッシュボードへリダイレクト
 *     - organization_member(かつ member レコードあり) → /agency
 *     - それ以外(seeker、または不完全な organization_member) → /app
 *
 * 振り分け条件は app/(agency)/agency/layout.tsx の guard と同じ式に揃える。
 * 仮にここの判定が崩れて organization_member を /app に飛ばしても、
 * /app の layout は seeker 前提なので素通し、逆に seeker を /agency に
 * 飛ばしても agency layout が getUserRole で弾いて /app に戻す。
 * 二重防御を維持するために、判定式を片方だけ緩めないこと。
 *
 * middleware ではなく page.tsx で判定する理由:
 *   middleware は全パスで getUser() を実行しているが、ロール判定の
 *   getUserRole は profiles + organization_members + member_permissions を
 *   引くため重い。/ への着地は限定的なので、ここでだけ実行する。
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const role = await getUserRole(user.id);
    const isAgencyMember =
      role.accountType === "organization_member" && role.organization && role.member;
    redirect(isAgencyMember ? "/agency" : "/app");
  }

  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl space-y-8 text-center">
        <div>
          <h1 className="mb-4 text-5xl font-bold tracking-tight">Maira</h1>
          <p className="text-muted-foreground mb-2 text-xl">あなただけのAI転職エージェント</p>
          <p className="text-muted-foreground text-sm">Coming Soon</p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button render={<Link href="/signup" />}>新規登録</Button>
          <Button variant="outline" render={<Link href="/login" />}>
            ログイン
          </Button>
        </div>
      </div>
    </main>
  );
}
