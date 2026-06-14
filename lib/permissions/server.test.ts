import { describe, it, expect } from "vitest";
import { canExport, memberHasPermission } from "./server";
import { emptyPermissionFlags } from "./types";
import type { UserRole } from "@/lib/organizations/types";

/**
 * 権限判定の境界テスト。
 *
 * 「admin は常に許可」は本プロジェクトの最重要ルールなので、書き忘れると
 * 機能が静かに使えなくなる。逆に advisor の権限フラグが緩いと、データ
 * エクスポート等の重要操作が漏れる。両方向の境界をテストで担保する。
 *
 * UserRole は organizations/types から、PermissionKey は permissions/types から
 * 統合的に使うため、ここが両者の整合性を検証する場所でもある。
 */

const baseOrg = {
  id: "org-1",
  name: "Test Org",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function memberRole(role: "admin" | "advisor", permissions = emptyPermissionFlags()): UserRole {
  return {
    accountType: "organization_member",
    organization: baseOrg,
    member: {
      id: "mem-1",
      organizationId: "org-1",
      userId: "user-1",
      role,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      permissions,
    },
  };
}

const seekerRole: UserRole = {
  accountType: "seeker",
  organization: null,
  member: null,
};

const memberWithoutMember: UserRole = {
  accountType: "organization_member",
  organization: baseOrg,
  member: null, // 招待途中など例外的なケース
};

describe("memberHasPermission — admin の特別扱い", () => {
  it("admin は permission flag が全部 false でも export を許可される(最重要ルール)", () => {
    const role = memberRole("admin", emptyPermissionFlags());
    expect(memberHasPermission(role, "export")).toBe(true);
  });

  it("admin は permission flag が true でも当然許可", () => {
    const role = memberRole("admin", { export: true });
    expect(memberHasPermission(role, "export")).toBe(true);
  });
});

describe("memberHasPermission — advisor の権限フラグ", () => {
  it("advisor + export=false は不許可", () => {
    const role = memberRole("advisor", { export: false });
    expect(memberHasPermission(role, "export")).toBe(false);
  });

  it("advisor + export=true は許可", () => {
    const role = memberRole("advisor", { export: true });
    expect(memberHasPermission(role, "export")).toBe(true);
  });

  it("advisor + デフォルト権限(emptyPermissionFlags)は不許可", () => {
    // 招待されたばかり / 権限未付与の advisor は何も出来ない契約
    const role = memberRole("advisor");
    expect(memberHasPermission(role, "export")).toBe(false);
  });
});

describe("memberHasPermission — 非企業メンバー", () => {
  it("seeker(求職者)は何も許可されない", () => {
    expect(memberHasPermission(seekerRole, "export")).toBe(false);
  });

  it("accountType=organization_member だが member=null も不許可(招待途中)", () => {
    expect(memberHasPermission(memberWithoutMember, "export")).toBe(false);
  });
});

describe("canExport ショートカット", () => {
  it("admin は permission に関わらず true", () => {
    expect(canExport(memberRole("admin"))).toBe(true);
    expect(canExport(memberRole("admin", { export: false }))).toBe(true);
  });

  it("advisor は export フラグに従う", () => {
    expect(canExport(memberRole("advisor", { export: true }))).toBe(true);
    expect(canExport(memberRole("advisor", { export: false }))).toBe(false);
  });

  it("seeker は常に false", () => {
    expect(canExport(seekerRole)).toBe(false);
  });

  it("memberHasPermission(role, 'export') と同じ結果を返す(契約の同値性)", () => {
    const cases: UserRole[] = [
      memberRole("admin"),
      memberRole("advisor", { export: true }),
      memberRole("advisor", { export: false }),
      seekerRole,
      memberWithoutMember,
    ];
    for (const r of cases) {
      expect(canExport(r)).toBe(memberHasPermission(r, "export"));
    }
  });
});
