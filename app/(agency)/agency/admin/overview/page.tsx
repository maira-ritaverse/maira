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
        <h1 className="text-2xl font-semibold">組織 の 全体 像</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          組織 → team → member の 隚層 と、 顧客 の 割 当 状況 を 可視 化 します。 team を 作って
          顧客 を 割 当 すると、 分離 の 効果 が 数字 で 見えます。
        </p>
      </div>

      <OrgTreeView graph={graph} />
    </div>
  );
}
