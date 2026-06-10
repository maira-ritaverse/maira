import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listOrganizationMembersWithMeta } from "@/lib/organizations/members";
import { buildInvitationUrl, listPendingInvitations } from "@/lib/organizations/invitations";
import { MembersTable } from "./members-table";
import { InvitationsSection } from "./invitations-section";

/**
 * メンバー管理画面(admin 専用)
 *
 * - layout.tsx で organization_member ガードは済んでいるが、admin チェックは
 *   ここで明示する(advisor が直 URL でアクセスしても弾く)。
 * - 「参加メンバー一覧」と「招待中」の2セクション構成。
 * - currentMemberId を渡して、テーブル側で「あなた」表示・自分自身の降格警告に使う。
 *
 * 招待中セクションには「招待リンクをコピー」ボタンを置く。Resend 未設定で
 * メール送信ができない場合でも、URL を手動で渡せるようにするため。
 */
export default async function MembersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // admin 限定:advisor のアクセスはクライアント一覧に戻す
  if (role.member.role !== "admin") {
    redirect("/agency/clients");
  }

  const [members, invitations] = await Promise.all([
    listOrganizationMembersWithMeta(role.organization.id),
    listPendingInvitations(role.organization.id),
  ]);

  // 招待リンクは NEXT_PUBLIC_SITE_URL を基準にサーバー側で組み立てて渡す
  // (S5 で /invite/[token] 着地ページが立つまでは「飛んでも参加できない」状態)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const invitationsWithUrl = invitations.map((inv) => ({
    invitation: inv,
    inviteUrl: siteUrl ? buildInvitationUrl(inv.token, siteUrl) : null,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">メンバー管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          組織に所属するメンバーの権限・招待を管理します
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">参加メンバー({members.length}名)</h2>
        <MembersTable members={members} currentMemberId={role.member.id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">招待中({invitations.length}件)</h2>
        <InvitationsSection invitations={invitationsWithUrl} />
      </section>
    </div>
  );
}
