import { redirect } from "next/navigation";

import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listOrganizationMembersWithMeta } from "@/lib/organizations/members";
import { listTeamsWithCounts } from "@/lib/teams/queries";

import { TeamsAdminClient } from "./teams-admin-client";

/**
 * /agency/settings/teams
 *
 * 組織 team の 管理 画面 (admin のみ)。 team CRUD + member 紐付け を UI で 提供。
 * SSR で 初期 データ を 取得 して、 クライアント で 編集 → API 経由 で 反映。
 */
export const dynamic = "force-dynamic";

export default async function TeamsSettingsPage() {
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
    // admin 以外 は 設定 の 一覧 に 戻す
    redirect("/agency/settings");
  }

  const [teams, members] = await Promise.all([
    listTeamsWithCounts(role.organization.id),
    listOrganizationMembersWithMeta(role.organization.id),
  ]);

  // 各 team の member を 並列 取得
  const { listTeamMembers } = await import("@/lib/teams/queries");
  const teamMemberships = await Promise.all(
    teams.map(async (t) => ({ teamId: t.id, members: await listTeamMembers(t.id) })),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <SettingsBackLink href="/agency/settings" />
      <div>
        <h1 className="text-2xl font-semibold">リスト表管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          組織内のリスト表を作成・編集して顧客を分離できます。リスト表に割り当てた顧客は同じリスト表のメンバーだけが閲覧でき、未割当の顧客は従来どおり全員が閲覧できます。管理者は常にすべての顧客を閲覧できます。
        </p>
      </div>

      <TeamsAdminClient
        initialTeams={teams}
        allMembers={members.map((m) => ({
          id: m.memberId,
          displayName: m.displayName ?? m.email ?? "(名前 未設定)",
          role: m.role,
        }))}
        teamMemberships={teamMemberships}
      />
    </div>
  );
}
