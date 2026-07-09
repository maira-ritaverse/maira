/**
 * 組織 team の 型 + zod スキーマ
 *
 * DB は 3 テーブル:
 *   organization_teams          - team 定義
 *   organization_team_members   - team ↔ member 多対多
 *   client_team_assignments     - team ↔ client 多対多
 *
 * RLS: client_records の SELECT は「admin / 未 割当 pool / 同 team」の
 * いずれ か で 可視 に なる 経路。 詳細 は 20260708000009 の コメント 参照。
 */
import { z } from "zod";

export type OrganizationTeam = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  /** UI 表示 用 の 色 (#RRGGBB)。 null で デフォルト グレー。 */
  color: string | null;
  sortOrder: number;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationTeamMemberRole = "member" | "lead";

export type OrganizationTeamMember = {
  teamId: string;
  memberId: string;
  role: OrganizationTeamMemberRole;
  addedAt: string;
  addedByMemberId: string | null;
};

export type ClientTeamAssignment = {
  clientRecordId: string;
  teamId: string;
  assignedAt: string;
  assignedByMemberId: string | null;
};

/**
 * team 詳細 (メンバー 数 + 顧客 数 を join した 集計 用)。 UI 一覧 で 表示。
 */
export type OrganizationTeamWithCounts = OrganizationTeam & {
  memberCount: number;
  clientCount: number;
};

// ────────────────────────────────────────────
// zod スキーマ (API リクエスト 用)
// ────────────────────────────────────────────

/** 16 進カラー (#RRGGBB) の検証。 大文字は小文字化して保存する前提。 */
const colorHexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "#RRGGBB 形式で入力してください")
  .transform((s) => s.toLowerCase())
  .nullable()
  .optional();

// 名前は前後の空白を除去した後に長さを判定する (「   」で通過を防ぐ)。
const teamNameSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, "リスト表名を入力してください")
  .refine((s) => s.length <= 100, "リスト表名は100文字以内で入力してください");

export const createTeamRequestSchema = z.object({
  name: teamNameSchema,
  description: z.string().max(500).nullable().optional(),
  color: colorHexSchema,
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

export const updateTeamRequestSchema = z.object({
  name: teamNameSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  color: colorHexSchema,
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});
export type UpdateTeamRequest = z.infer<typeof updateTeamRequestSchema>;

export const setTeamMemberRequestSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["member", "lead"]).default("member"),
});
export type SetTeamMemberRequest = z.infer<typeof setTeamMemberRequestSchema>;

export const assignClientTeamsRequestSchema = z.object({
  /** 割当 したい team_id の 集合 (差分 は API 側 で 計算)。 */
  teamIds: z.array(z.string().uuid()).max(20),
});
export type AssignClientTeamsRequest = z.infer<typeof assignClientTeamsRequestSchema>;
