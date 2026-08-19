import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * トップページ (app.maira.pro/)
 *
 * - 未ログイン: /login に 即 リダイレクト (旧 LP コンポーネントは削除済み)
 *   ・エージェント 向け LP は maira.pro / www.maira.pro (Xserver 上 WordPress)
 *     に あり、 アプリ ドメイン に 重複 LP を 置く 必要 が なくなった
 *   ・アプリ ドメイン を 開いた 人 は 「ログイン したい」 意図 が 大半 な ので
 *     LP を 挟まず ログイン 画面 に 直行 させる 方針
 * - ログイン済み: account_type に応じてダッシュボードへリダイレクト
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
 *
 * 補足: プレビューページの LandingPagePreview(landing-page-preview.tsx)は
 * 別コンポーネントで現役。旧 landing-page.tsx は削除済み。
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

  redirect("/login");
}
