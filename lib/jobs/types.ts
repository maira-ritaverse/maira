/**
 * 求人情報(エージェント企業所有)の型定義
 *
 * client_records と同じく企業所有のテナント分離パターン。
 * 年収は「万円」単位の整数で保持する(DBスキーマも同じ)。
 */

import { z } from "zod";

export type JobStatus = "open" | "paused" | "closed";

export const jobStatusLabels: Record<JobStatus, string> = {
  open: "募集中",
  paused: "停止中",
  closed: "終了",
};

export type JobPosting = {
  id: string;
  organizationId: string;
  companyName: string;
  position: string;
  employmentType: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string | null;
  requiredSkills: string | null;
  preferredSkills: string | null;
  status: JobStatus;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

// 年収バリデーション(0〜100000万円 = 0〜10億円。実用上充分な上限)
// 空文字を null に変換するためのプリプロセッサ:
//   <input type="number"> は未入力時に "" を返すケースがあるため、
//   z.number() の前段で空文字/undefined を null に正規化する。
const salaryField = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return null;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isNaN(n) ? val : n;
  }
  return val;
}, z.number().int().min(0).max(100000).nullable());

export const createJobRequestSchema = z.object({
  company_name: z.string().min(1, "求人企業名を入力してください").max(100),
  position: z.string().min(1, "職種を入力してください").max(100),
  employment_type: z.string().max(50).optional().or(z.literal("")),
  location: z.string().max(100).optional().or(z.literal("")),
  salary_min: salaryField.optional(),
  salary_max: salaryField.optional(),
  description: z.string().max(5000).optional().or(z.literal("")),
  required_skills: z.string().max(2000).optional().or(z.literal("")),
  preferred_skills: z.string().max(2000).optional().or(z.literal("")),
  status: z.enum(["open", "paused", "closed"]).default("open"),
});

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const updateJobRequestSchema = z.object({
  company_name: z.string().min(1).max(100).optional(),
  position: z.string().min(1).max(100).optional(),
  employment_type: z.string().max(50).optional().or(z.literal("")),
  location: z.string().max(100).optional().or(z.literal("")),
  salary_min: salaryField.optional(),
  salary_max: salaryField.optional(),
  description: z.string().max(5000).optional().or(z.literal("")),
  required_skills: z.string().max(2000).optional().or(z.literal("")),
  preferred_skills: z.string().max(2000).optional().or(z.literal("")),
  status: z.enum(["open", "paused", "closed"]).optional(),
});

export type UpdateJobRequest = z.infer<typeof updateJobRequestSchema>;

/**
 * 年収レンジを画面表示用の文字列に整形する
 * - 両方あり: "500〜700万円"
 * - 下限のみ: "500万円〜"
 * - 上限のみ: "〜700万円"
 * - どちらもなし: "応相談"
 */
export function formatSalaryRange(salaryMin: number | null, salaryMax: number | null): string {
  if (salaryMin !== null && salaryMax !== null) {
    return `${salaryMin}〜${salaryMax}万円`;
  }
  if (salaryMin !== null) return `${salaryMin}万円〜`;
  if (salaryMax !== null) return `〜${salaryMax}万円`;
  return "応相談";
}
