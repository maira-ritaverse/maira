import {
  emptyPermissionFlags,
  PERMISSION_KEYS,
  type MemberPermissionFlags,
  type PermissionKey,
} from "@/lib/permissions/types";
import { resolveAvatarPublicUrl } from "@/lib/profile/avatar";
import { createClient } from "@/lib/supabase/server";

import type { OrganizationRole } from "./types";

/**
 * メンバー一覧 + 権限フラグ をまとめて取得する(管理画面用)。
 *
 * - list_organization_members_with_meta RPC で同 org のメンバーを取得(email を含む)
 * - member_permissions を 1 クエリで取得(member_id をキーに合流、N+1 回避)
 * - admin の特例(常に許可)は適用しない。判定側で
 *   `role === 'admin' || permissions[key]` のように扱う想定。
 *
 * 呼び出し元(API/page)は別途、認証 + admin 権限チェックを済ませている前提だが、
 * RPC 側でも「呼び出しユーザーが同 org メンバー」を検証している(二重防御)。
 */

export type OrganizationMemberListItem = {
  memberId: string;
  userId: string;
  role: OrganizationRole;
  displayName: string | null;
  email: string | null;
  /** アバター 画像 の public URL (null = 未設定 / フォールバック 表示) */
  avatarUrl: string | null;
  createdAt: string;
  permissions: MemberPermissionFlags;
};

const KNOWN_PERMISSION_KEYS = new Set<string>(Object.values(PERMISSION_KEYS));

export async function listOrganizationMembersWithMeta(
  organizationId: string,
): Promise<OrganizationMemberListItem[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase.rpc("list_organization_members_with_meta", {
    target_organization_id: organizationId,
  });

  if (error) {
    throw new Error(`Failed to list members: ${error.message}`);
  }

  const members =
    (rows as Array<{
      member_id: string;
      user_id: string;
      role: string;
      display_name: string | null;
      email: string | null;
      avatar_storage_path: string | null;
      created_at: string;
    }> | null) ?? [];

  if (members.length === 0) return [];

  // 同 org の権限を一括取得(N+1 回避)
  const { data: permRows } = await supabase
    .from("member_permissions")
    .select("member_id, permission_key, granted")
    .eq("organization_id", organizationId);

  const permsByMember = new Map<string, MemberPermissionFlags>();
  if (permRows) {
    for (const row of permRows) {
      const key = row.permission_key as string;
      if (!KNOWN_PERMISSION_KEYS.has(key)) continue;
      const existing = permsByMember.get(row.member_id) ?? emptyPermissionFlags();
      if (row.granted) {
        existing[key as PermissionKey] = true;
      }
      permsByMember.set(row.member_id, existing);
    }
  }

  return members.map((m) => ({
    memberId: m.member_id,
    userId: m.user_id,
    role: m.role as OrganizationRole,
    displayName: m.display_name,
    email: m.email,
    avatarUrl: resolveAvatarPublicUrl(supabase, m.avatar_storage_path),
    createdAt: m.created_at,
    permissions: permsByMember.get(m.member_id) ?? emptyPermissionFlags(),
  }));
}
