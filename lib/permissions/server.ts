/**
 * 権限判定の共通ヘルパー(サーバー側)
 *
 * UI と API の両方で同じ判定を使うため、関数化して 1 か所に集約する。
 * 「admin は常に許可」のルールを書き忘れる事故を防ぐ。
 */

import type { UserRole } from "@/lib/organizations/types";
import type { PermissionKey } from "./types";

/**
 * 指定の権限キーを持っているかを判定する。
 * - admin → 常に true(member.permissions に関わらず)
 * - advisor → member.permissions[key] が true なら true
 * - 企業メンバーでない / メンバー未登録 → false
 */
export function memberHasPermission(role: UserRole, key: PermissionKey): boolean {
  if (role.accountType !== "organization_member" || !role.member) return false;
  if (role.member.role === "admin") return true;
  return role.member.permissions[key] === true;
}

/**
 * エクスポート可否(よく使うショートカット)。
 */
export function canExport(role: UserRole): boolean {
  return memberHasPermission(role, "export");
}
