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
  // マイグレーション 20260615000004 で追加された 8 列。すべて NULL 許容。
  // 法定明示事項 + 2024年改正労基法対応 + エージェント業務で頻出の確認項目。
  workChangeScope: string | null; // 業務内容(変更の範囲)
  locationChangeScope: string | null; // 就業場所(変更の範囲)
  smokingPreventionMeasure: string | null; // 受動喫煙防止措置
  probationPeriod: string | null; // 試用期間
  workHours: string | null; // 勤務時間
  breakTime: string | null; // 休憩時間
  holidays: string | null; // 休日休暇
  applicationQualifications: string | null; // 応募資格
  // 20260629000010 で追加。 求人 メイン画像 / LINE 配信用 画像 の Storage パス。
  heroImagePath: string | null;
  lineShareImagePath: string | null;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 求人 画像 の 種別。
 *   hero       求人 詳細 / 一覧 で 表示 する メイン 画像
 *   line_share LINE 配信 (Flex 求人カード) で 使う 画像。 設定 無し なら hero を 使う
 */
export type JobImageKind = "hero" | "line_share";

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

// 上限は AI 抽出 schema (lib/ai/prompts/job-extract-from-document.ts) と 揃えること。
// AI が ★ 区切りで 集約する 設計に した 結果、従来の 2000/5000 字 では 媒体票が
// 入りきらず「AI 出力の 構造が 不正でした」が 出ていた。DB は text 型 で 無制限
// なので、運用余裕を 最大化 した 数値に 設定する。
const labourField = z.string().max(6000).optional().or(z.literal(""));
const descriptionField = z.string().max(20000).optional().or(z.literal(""));
const shortTextField = z.string().max(500).optional().or(z.literal(""));

export const createJobRequestSchema = z.object({
  company_name: z.string().min(1, "求人企業名を入力してください").max(500),
  position: z.string().min(1, "職種を入力してください").max(500),
  employment_type: shortTextField,
  location: shortTextField,
  salary_min: salaryField.optional(),
  salary_max: salaryField.optional(),
  description: descriptionField,
  required_skills: labourField,
  preferred_skills: labourField,
  status: z.enum(["open", "paused", "closed"]).default("open"),
  work_change_scope: labourField,
  location_change_scope: labourField,
  smoking_prevention_measure: labourField,
  probation_period: labourField,
  work_hours: labourField,
  break_time: labourField,
  holidays: labourField,
  application_qualifications: labourField,
});

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const updateJobRequestSchema = z.object({
  company_name: z.string().min(1).max(500).optional(),
  position: z.string().min(1).max(500).optional(),
  employment_type: shortTextField,
  location: shortTextField,
  salary_min: salaryField.optional(),
  salary_max: salaryField.optional(),
  description: descriptionField,
  required_skills: labourField,
  preferred_skills: labourField,
  status: z.enum(["open", "paused", "closed"]).optional(),
  work_change_scope: labourField,
  location_change_scope: labourField,
  smoking_prevention_measure: labourField,
  probation_period: labourField,
  work_hours: labourField,
  break_time: labourField,
  holidays: labourField,
  application_qualifications: labourField,
});

export type UpdateJobRequest = z.infer<typeof updateJobRequestSchema>;

/**
 * 法定明示事項(マイグレーション 20260615000004 で追加された 8 列)の入力完了数を数える。
 *
 * 求人カードや一覧で「N/8 入力済み」のように進捗を可視化する用途。
 * 空白のみ(`"   "`)も「未入力」として扱うのが業務的に自然(意図的な空白入力を弾く)。
 *
 * テストしやすい純粋関数として export。
 */
export const LABOUR_FIELDS_TOTAL = 8 as const;

export function countLabourFieldsFilled(job: JobPosting): number {
  const fields: (string | null)[] = [
    job.workChangeScope,
    job.locationChangeScope,
    job.smokingPreventionMeasure,
    job.probationPeriod,
    job.workHours,
    job.breakTime,
    job.holidays,
    job.applicationQualifications,
  ];
  return fields.filter((v) => v !== null && v.trim() !== "").length;
}

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
