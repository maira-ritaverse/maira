import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { OrganizationInvitation } from "./types";

/**
 * 招待トークンを生成する。
 *
 * Node の crypto.randomBytes(32) = 256bit の暗号学的に安全なエントロピー。
 * base64url にして URL に直接埋め込めるようにする。
 * 衝突確率は事実上 0(token カラムには unique 制約あり、保険として再試行は不要)。
 *
 * ⚠️ Math.random() は絶対に使わない(暗号学的に安全でない)。
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 招待の有効期限(発行から 7 日)。
 */
export function defaultInvitationExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * 期限切れを判定する補助関数(DB の status とは別の表示判定)。
 * status が pending でも expires_at を過ぎていれば実質「期限切れ」。
 */
export function isInvitationExpired(inv: OrganizationInvitation, now: Date = new Date()): boolean {
  return inv.status === "pending" && new Date(inv.expiresAt).getTime() < now.getTime();
}

type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  invited_by_member_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

function rowToInvitation(row: InvitationRow): OrganizationInvitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role as OrganizationInvitation["role"],
    token: row.token,
    status: row.status as OrganizationInvitation["status"],
    invitedByMemberId: row.invited_by_member_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}

/**
 * 同 org の pending 招待を取得(管理画面の「招待中」セクション用)。
 * created_at 降順。RLS で自社のみだが二重防御で organization_id を明示。
 */
export async function listPendingInvitations(
  organizationId: string,
): Promise<OrganizationInvitation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organization_invitations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as InvitationRow[]).map(rowToInvitation);
}

/**
 * 招待リンクの URL を組み立てる。
 * NEXT_PUBLIC_SITE_URL を基準にする。S5 で /invite/[token] の着地ページを実装する。
 *
 * 末尾スラッシュの有無を吸収する。
 */
export function buildInvitationUrl(token: string, siteUrl: string): string {
  const trimmed = siteUrl.replace(/\/+$/, "");
  return `${trimmed}/invite/${token}`;
}
