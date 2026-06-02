/**
 * メンバー権限の型定義(S1)
 *
 * 設計方針:
 *   - admin は本ファイルの権限フラグに関わらず常に許可される。
 *     呼び出し側 or ヘルパーで `role === 'admin' || permissions[key]` のように判定する。
 *   - 権限キーはアプリ側で集中管理し、DB の member_permissions.permission_key と同期する。
 *   - 最初は export だけ。書き出し系の機能が増えたら PERMISSION_KEYS を拡張する。
 */

export const PERMISSION_KEYS = {
  EXPORT: "export",
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

/**
 * UI 表示用のラベル・説明。
 * 権限キーを追加したら必ずここにも追加する。
 */
export const permissionConfig: Record<PermissionKey, { label: string; description: string }> = {
  export: {
    label: "データのエクスポート",
    description: "クライアントやレポートの CSV/PDF エクスポートを許可する。",
  },
};

/**
 * member_permissions 1行に対応する型。
 */
export type MemberPermission = {
  id: string;
  organizationId: string;
  memberId: string;
  permissionKey: PermissionKey;
  granted: boolean;
  grantedByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * メンバーの権限を 1 オブジェクトにまとめた表現。
 * member_permissions に行が無いキーは false 扱い。
 */
export type MemberPermissionFlags = Record<PermissionKey, boolean>;

/**
 * 全権限を false で埋めたデフォルトを返す。
 * member_permissions に何も無いメンバー用。
 */
export function emptyPermissionFlags(): MemberPermissionFlags {
  return {
    export: false,
  };
}
