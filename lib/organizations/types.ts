/**
 * マルチテナント基盤の型定義
 *
 * - account_type: 'seeker'(求職者) または 'organization_member'(企業メンバー)
 * - organization_member の中の役割: 'admin'(管理者) または 'advisor'(アドバイザー)
 * - 1アカウント1ロール、1メンバー1企業所属(兼任は今は考えない)
 */

import type { MemberPermissionFlags } from "@/lib/permissions/types";

export type AccountType = "seeker" | "organization_member";

export type OrganizationRole = "admin" | "advisor";

export type Organization = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
  /**
   * メンバーに付与された権限フラグ。
   * member_permissions に行が無いキーは false。
   * 注意:admin はこのフラグに関わらず常に許可されるため、判定時は
   *       role === 'admin' || permissions[key] のように扱う。
   */
  permissions: MemberPermissionFlags;
};

/**
 * ユーザーのロール情報
 *
 * - accountType === 'seeker': organization も member も null
 * - accountType === 'organization_member': 両方が入る(招待途中等の例外あり、queries側で seeker に倒す)
 */
export type UserRole = {
  accountType: AccountType;
  organization: Organization | null;
  member: OrganizationMember | null;
};

/**
 * 招待ステータス。
 * - pending: 発行済、未受諾、未失効
 * - accepted: 受諾済(accepted_at が入る)
 * - expired: expires_at を過ぎた(or バッチで明示的に切られた)
 * - revoked: admin が手動で取り消した
 */
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type OrganizationInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  token: string;
  status: InvitationStatus;
  invitedByMemberId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

/**
 * member_audit_log 1行に対応する型。
 * action は自由文字列だが、アプリ側で集合を絞って使うことを想定。
 * detail には before/after の差分等を jsonb で入れる。
 */
export type MemberAuditLog = {
  id: string;
  organizationId: string;
  targetMemberId: string;
  action: string;
  detail: Record<string, unknown> | null;
  changedByMemberId: string | null;
  changedAt: string;
  createdAt: string;
};
