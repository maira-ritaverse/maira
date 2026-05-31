/**
 * マルチテナント基盤の型定義
 *
 * - account_type: 'seeker'(求職者) または 'organization_member'(企業メンバー)
 * - organization_member の中の役割: 'admin'(管理者) または 'advisor'(アドバイザー)
 * - 1アカウント1ロール、1メンバー1企業所属(兼任は今は考えない)
 */

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
