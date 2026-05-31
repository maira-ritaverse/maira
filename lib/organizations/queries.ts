import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "./types";

/**
 * ユーザーのロール情報を取得する
 *
 * 流れ:
 * 1. profiles.account_type を取得
 * 2. 'seeker' ならそのまま返す
 * 3. 'organization_member' なら organization_members を join して所属企業も返す
 *
 * 安全側設計:
 *   account_type が organization_member でも、実際の organization_members レコードが
 *   存在しない場合(招待途中など)は seeker として扱う。
 *   → 「企業メンバーのフリをして全テナント横断のデータが見える」事故を防ぐため。
 */
export async function getUserRole(userId: string): Promise<UserRole> {
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
    },
  };
}

/**
 * ユーザーが企業メンバーかどうかの簡易判定
 * (account_type だけでなく実レコードの存在も確認する)
 */
export async function isOrganizationMember(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return role.accountType === "organization_member" && role.member !== null;
}
