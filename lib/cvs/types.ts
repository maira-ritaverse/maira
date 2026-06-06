import { z } from "zod";

/**
 * 職務経歴書(JIS様式、構造化データ)の型定義
 *
 * 既存の lib/resumes/types.ts(履歴書)とは別物。
 * 履歴書が「個人情報 + 学歴・職歴行 + 自由記述」なのに対し、
 * 職務経歴書は「職務要約 / 職務経歴(逆編年式) / スキル / 自己PR」の構造化データ。
 *
 * 設計方針:
 * - 事実(会社名・期間・役職)はユーザー入力必須項目として扱う(AIに捏造させない)
 * - 文章(業務内容・実績・職務要約・自己PR)は空文字を許可(下書き保存可)
 *   Phase 4 で AI 下書きボタンを足すが、AIは事実を作らず「文章化」のみを担当
 * - 資格は持たない:license_resume_id で履歴書から参照する
 * - DB の snake_case と camelCase は queries 層で変換する(履歴書と同じパターン)
 */

// ============================================
// 期間(年月)
//
// year/month とも数値必須。null は使わない。
// 「現在」を表すには WorkExperience.period_end を null にする。
// ============================================
export const periodPointSchema = z.object({
  year: z.number().int().min(1950).max(2100),
  month: z.number().int().min(1).max(12),
});
export type PeriodPoint = z.infer<typeof periodPointSchema>;

// ============================================
// 雇用形態
// ============================================
export const employmentTypes = ["full_time", "contract", "part_time", "other"] as const;
export type EmploymentType = (typeof employmentTypes)[number];

export const employmentTypeLabels: Record<EmploymentType, string> = {
  full_time: "正社員",
  contract: "契約社員",
  part_time: "アルバイト・パート",
  other: "その他",
};

// ============================================
// 職務経歴 1 件(逆編年式で並べる)
//
// 必須(事実):company_name のみ。下書きで「会社名だけ書いて後で詰める」を許す。
// industry/position 等は null 許容。
// job_description/achievements は空文字許可(Phase 4 の AI 下書き前は空のはず)。
// ============================================
export const workExperienceSchema = z.object({
  company_name: z.string().min(1, "会社名は必須です").max(200),
  industry: z.string().max(100).nullable(),
  period_start: periodPointSchema.nullable(),
  // null = 「現在も在籍」を表す
  period_end: periodPointSchema.nullable(),
  position: z.string().max(200).nullable(),
  employment_type: z.enum(employmentTypes).nullable(),
  // 業務内容(箇条書きでも文章でも可、改行込み)
  job_description: z.string().max(2000),
  // 実績・成果(数値があれば数値、なければ定性)
  achievements: z.string().max(2000),
});
export type WorkExperience = z.infer<typeof workExperienceSchema>;

// ============================================
// スキル 1 件
//
// category と name は必須(空のスキル行を保存させない)。
// 下書きで「カテゴリだけ選んで名前は後」を許容するなら、UI 側で
// name 空の行を保存前にフィルタする運用にする(API 側でも同様)。
// ============================================
export const skillCategories = [
  "language",
  "framework",
  "tool",
  "soft_skill",
  "domain",
  "other",
] as const;
export type SkillCategory = (typeof skillCategories)[number];

export const skillCategoryLabels: Record<SkillCategory, string> = {
  language: "プログラミング言語",
  framework: "フレームワーク・ライブラリ",
  tool: "ツール・環境",
  soft_skill: "ソフトスキル",
  domain: "業界・ドメイン知識",
  other: "その他",
};

export const skillLevels = ["basic", "intermediate", "advanced"] as const;
export type SkillLevel = (typeof skillLevels)[number];

export const skillLevelLabels: Record<SkillLevel, string> = {
  basic: "初級",
  intermediate: "中級",
  advanced: "上級",
};

export const skillSchema = z.object({
  category: z.enum(skillCategories),
  name: z.string().min(1, "スキル名は必須です").max(100),
  level: z.enum(skillLevels).nullable(),
  description: z.string().max(500).nullable(),
});
export type Skill = z.infer<typeof skillSchema>;

// ============================================
// 暗号化対象の本文(encrypted_body の中身)
//
// summary / self_pr は空文字許可(下書き保存可、Phase 4 で AI 下書きを足す)。
// ============================================
export const cvBodySchema = z.object({
  summary: z.string().max(1500),
  work_experiences: z.array(workExperienceSchema),
  skills: z.array(skillSchema),
  self_pr: z.string().max(2000),
});
export type CvBody = z.infer<typeof cvBodySchema>;

/**
 * 空の CvBody。新規作成時の初期値。
 *
 * 履歴書の defaultValues 同様、フォームの buildDefaultValues から参照する。
 */
export function emptyCvBody(): CvBody {
  return {
    summary: "",
    work_experiences: [],
    skills: [],
    self_pr: "",
  };
}

// ============================================
// アプリ内で扱う Cv(camelCase)
//
// DB の snake_case とは別。queries 層で変換する(履歴書と同じ)。
// ============================================
export type Cv = {
  id: string;
  userId: string;
  title: string;
  // 履歴書と同じく「○年○月○日 現在」用の表示日(null なら本日)
  documentDate: string | null;
  // 資格を引いてくる履歴書の参照(null 可)
  licenseResumeId: string | null;
  // 暗号化境界の内側:DB では encrypted_body に詰まっている
  body: CvBody;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// 保存リクエスト(新規・更新共通)
//
// 下書き保存を許すため、必須は title のみ。
// document_date は空文字 or 省略 OK(履歴書と同じ運用)。
// プロパティ名は API 受け口に合わせて snake_case。
// ============================================
export const saveCvRequestSchema = z.object({
  title: z.string().min(1, "タイトルは必須です").max(100),
  document_date: z.string().optional().or(z.literal("")), // YYYY-MM-DD
  // 履歴書未選択は null/省略 OK
  license_resume_id: z.string().uuid().nullable().optional(),
  body: cvBodySchema,
});
export type SaveCvRequest = z.infer<typeof saveCvRequestSchema>;
