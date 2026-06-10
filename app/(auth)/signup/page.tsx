import { createServiceClient } from "@/lib/supabase/service";
import type { OrganizationRole } from "@/lib/organizations/types";
import { SignupForm } from "./signup-form";

type InvitationRow = {
  email: string;
  role: OrganizationRole;
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
  organizations: { name: string } | { name: string }[] | null;
};

/**
 * サインアップページ(Server Component)
 *
 * 通常の求職者向けサインアップ + 招待経由のサインアップを 1 ページで扱う。
 * - ?invitationToken=xxx が付いていれば、招待行を service_role で検証
 *   (有効・pending・期限内)し、招待メール/組織名/role を Client Form に渡す
 * - 無効な token / 期限切れ / 既受諾の招待は無視して通常のサインアップに倒す
 *   (UX:エラー画面より「普通に登録できる」方が脱落が少ない。あえて止めない)
 *
 * email は招待のものを信頼境界として採用する。
 *   URL の ?email= は使わない(改ざんで誤誘導される余地を消す)。
 *   Client 側でも email は readonly + Server Action 側で再上書き。
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invitationToken?: string }>;
}) {
  const { invitationToken } = await searchParams;

  let invitation = null;

  if (invitationToken) {
    const service = createServiceClient();
    const { data } = await service
      .from("organization_invitations")
      .select(
        `
        email,
        role,
        status,
        expires_at,
        organizations ( name )
      `,
      )
      .eq("token", invitationToken)
      .maybeSingle<InvitationRow>();

    const now = new Date();
    const isValid =
      data && data.status === "pending" && new Date(data.expires_at).getTime() > now.getTime();

    if (isValid) {
      const orgRaw = data.organizations;
      const organizationName =
        (Array.isArray(orgRaw) ? orgRaw[0]?.name : orgRaw?.name) ?? "(不明な組織)";
      invitation = {
        token: invitationToken,
        email: data.email,
        organizationName,
        role: data.role,
      };
    }
  }

  return <SignupForm invitation={invitation} />;
}
