import { redirect } from "next/navigation";

import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";
import { buildOrganizationGraph } from "@/lib/teams/graph";

import { OrgTreeView } from "./org-tree-view";

/**
 * /agency/admin/overview
 *
 * 組織 の 隚層 構造 を ツリー で 可視化 する admin 用 ページ。
 * team の 有無、 各 team の member/client 数、 主 担当 別 の 顧客 数 を 一覧 化。
 *
 * 大 規模 組織 では ノード が 多く なる が、 初期 は 全 展開 で 表示。
 * 遅延 展開 が 必要 に なった 段階 で 段階 的 に 導入 する 予定。
 */
export const dynamic = "force-dynamic";

export default async function OrgOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }
  if (role.member?.role !== "admin") {
    redirect("/agency");
  }

  const graph = await buildOrganizationGraph(role.organization.id);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">組織の全体像</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          組織 → リスト表 →
          メンバーの階層と顧客の割当状況を可視化します。リスト表を作って顧客を割り当てると、分離の効果が数字で見えます。
        </p>
      </div>

      <OrgTreeView graph={graph} />
    </div>
  );
}
