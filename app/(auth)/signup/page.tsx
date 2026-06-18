import { redirect } from "next/navigation";

import { isOpenSignupEnabled } from "@/lib/config/signup-mode";
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

type ClientInvitationRow = {
  email: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
  organization_id: string;
  client_record_id: string;
  organizations: { name: string } | { name: string }[] | null;
  client_records: { name: string } | { name: string }[] | null;
};

/**
 * サインアップページ(Server Component)
 *
 * 3 系統のサインアップを 1 ページで扱う:
 *
 *  A) ?invitationToken=xxx        … エージェントメンバー招待
 *  B) ?clientInvitationToken=xxx  … 求職者(client_record)招待
 *  C) 招待トークン無し            … 自由登録(`isOpenSignupEnabled()` でゲート)
 *
 * email は招待のものを信頼境界として採用する(URL の ?email= は使わない:
 * 改ざんで誤誘導される余地を消すため)。Client 側でも email は readonly +
 * Server Action 側で再上書き。
 *
 * 無効 / 期限切れトークンは:
 *  - メンバー招待(A):無視して 自由登録 経路へ(SignupPage の従来挙動)
 *  - 求職者招待(B):無効なら /login にフォールバック(求職者は自由登録不可)
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invitationToken?: string; clientInvitationToken?: string }>;
}) {
  const { invitationToken, clientInvitationToken } = await searchParams;

  let invitation = null;
  let clientInvitation: {
    token: string;
    email: string;
    organizationName: string;
    seekerName: string;
  } | null = null;

  // ─── A) メンバー招待(従来挙動)─────────────────────────────────
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

  // ─── B) 求職者招待 ────────────────────────────────────────────
  // メンバー招待が優先される(両方付いていることは想定外:UI 経路で混入しない)
  if (!invitation && clientInvitationToken) {
    const service = createServiceClient();
    const { data } = await service
      .from("client_invitations")
      .select(
        `
        email,
        status,
        expires_at,
        organization_id,
        client_record_id,
        organizations ( name ),
        client_records ( name )
      `,
      )
      .eq("token", clientInvitationToken)
      .maybeSingle<ClientInvitationRow>();

    const now = new Date();
    const isValid =
      data && data.status === "pending" && new Date(data.expires_at).getTime() > now.getTime();

    if (isValid) {
      const orgRaw = data.organizations;
      const organizationName =
        (Array.isArray(orgRaw) ? orgRaw[0]?.name : orgRaw?.name) ?? "(不明な組織)";
      const seekerRaw = data.client_records;
      const seekerName = (Array.isArray(seekerRaw) ? seekerRaw[0]?.name : seekerRaw?.name) ?? "";
      clientInvitation = {
        token: clientInvitationToken,
        email: data.email,
        organizationName,
        seekerName,
      };
    } else {
      // 求職者招待が無効 / 期限切れ:自由登録は許可されていないので login へ。
      redirect("/login?reason=invitation_invalid");
    }
  }

  // ─── C) 招待無し:BtoBtoC モードなら login へ ────────────────────
  if (!invitation && !clientInvitation && !isOpenSignupEnabled()) {
    redirect("/login?reason=signup_closed");
  }

  return <SignupForm invitation={invitation} clientInvitation={clientInvitation} />;
}
