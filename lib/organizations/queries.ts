import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { emptyPermissionFlags, type PermissionKey } from "@/lib/permissions/types";
import { PERMISSION_KEYS } from "@/lib/permissions/types";
import type { UserRole } from "./types";

/**
 * 権限キーの集合(O(1) 判定用)。
 * 未知のキーが member_permissions に入っていても無視する。
 */
const KNOWN_PERMISSION_KEYS = new Set<string>(Object.values(PERMISSION_KEYS));

/**
 * ユーザーのロール情報を取得する
 *
 * 流れ:
 * 1. profiles.account_type を取得
 * 2. 'seeker' ならそのまま返す
 * 3. 'organization_member' なら organization_members を join して所属企業も返す
 * 4. organization_member なら member_permissions も取得して member.permissions に詰める
 *
 * 安全側設計:
 *   account_type が organization_member でも、実際の organization_members レコードが
 *   存在しない場合(招待途中など)は seeker として扱う。
 *   → 「企業メンバーのフリをして全テナント横断のデータが見える」事故を防ぐため。
 *
 * 権限について:
 *   member.permissions には member_permissions の granted=true 分だけ true を立てる。
 *   admin の特例(常に許可)はここでは適用しない。判定側で
 *   `role === 'admin' || permissions[key]` のように扱う。
 */
export const getUserRole = cache(async (userId: string): Promise<UserRole> => {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_type")
    .eq("id", userId)
    .maybeSingle();

  const accountType = (profile?.account_type ?? "seeker") as "seeker" | "organization_member";

  if (accountType === "seeker") {
    return {
      accountType: "seeker",
      organization: null,
      member: null,
    };
  }

  const { data: memberRow } = await supabase
    .from("organization_members")
    .select(
      `
      id,
      organization_id,
      user_id,
      role,
      created_at,
      updated_at,
      organizations (
        id,
        name,
        created_at,
        updated_at
      )
    `,
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!memberRow) {
    // account_type は organization_member だが、まだメンバーレコードがない
    // → 安全側で seeker として返す
    return {
      accountType: "seeker",
      organization: null,
      member: null,
    };
  }

  // Supabaseの型推論で organizations は配列 or オブジェクトのどちらでも来うる
  // (リレーションの種別による)。両方に対応する。
  const orgRaw = memberRow.organizations;
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

  // member_permissions を取得して granted=true のキーだけ true に。
  // テーブル未作成や RLS で 0 件のケースもエラーにせず空フラグで返す。
  const permissions = emptyPermissionFlags();
  const { data: permRows } = await supabase
    .from("member_permissions")
    .select("permission_key, granted")
    .eq("member_id", memberRow.id);

  if (permRows) {
    for (const row of permRows) {
      const key = row.permission_key as string;
      if (KNOWN_PERMISSION_KEYS.has(key) && row.granted) {
        permissions[key as PermissionKey] = true;
      }
    }
  }

  return {
    accountType: "organization_member",
    organization: org
      ? {
          id: org.id,
          name: org.name,
          createdAt: org.created_at,
          updatedAt: org.updated_at,
        }
      : null,
    member: {
      id: memberRow.id,
      organizationId: memberRow.organization_id,
      userId: memberRow.user_id,
      role: memberRow.role as "admin" | "advisor",
      createdAt: memberRow.created_at,
      updatedAt: memberRow.updated_at,
      permissions,
    },
  };
});

/**
 * ユーザーが企業メンバーかどうかの簡易判定
 * (account_type だけでなく実レコードの存在も確認する)
 */
export async function isOrganizationMember(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return role.accountType === "organization_member" && role.member !== null;
}
