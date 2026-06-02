import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listOrganizationMembersWithMeta } from "@/lib/organizations/members";
import { MembersTable } from "./members-table";

/**
 * メンバー管理画面(admin 専用)
 *
 * - layout.tsx で organization_member ガードは済んでいるが、admin チェックは
 *   ここで明示する(advisor が直 URL でアクセスしても弾く)。
 * - 「参加メンバー一覧」だけを表示する。招待中セクションは S4 以降。
 * - currentMemberId を渡して、テーブル側で「あなた」表示・自分自身の降格警告に使う。
 */
export default async function MembersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // admin 限定:advisor のアクセスはクライアント一覧に戻す
  if (role.member.role !== "admin") {
    redirect("/agency/clients");
  }

  const members = await listOrganizationMembersWithMeta(role.organization.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">メンバー管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          組織に所属するメンバーの権限を管理します
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">参加メンバー({members.length}名)</h2>
        <MembersTable members={members} currentMemberId={role.member.id} />
      </section>
    </div>
  );
}
