import { z } from "zod";

/**
 * 強みのカテゴリ
 * - hard_skill: 技術スキル、専門知識
 * - soft_skill: コミュニケーション、リーダーシップ等
 * - experience: 特定の経験(プロジェクト遂行、海外勤務等)
 */
const strengthCategorySchema = z.enum(["hard_skill", "soft_skill", "experience"]);

/**
 * 個別の強み
 */
const strengthSchema = z.object({
  label: z.string().describe("強みのラベル(例:ユーザー視点の機能設計)"),
  evidence: z.string().describe("会話から抽出した、その強みを裏付ける具体例"),
  category: strengthCategorySchema.describe("強みのカテゴリ"),
});

/**
 * ユーザーの基本情報(事実)
 */
const userFactsSchema = z.object({
  current_role: z.string().nullable().describe("現在の職種・役職"),
  years_of_experience: z.number().nullable().describe("実務経験年数"),
  industry: z.string().nullable().describe("現在の業界"),
  company_size: z.string().nullable().describe("現在の会社の規模(例:100-500名)"),
});

/**
 * 希望(次のキャリアで求めること)
 */
const wantsSchema = z.object({
  industries: z.array(z.string()).describe("希望する業界(複数可)"),
  role_types: z.array(z.string()).describe("希望する職種・役割(複数可)"),
  company_sizes: z.array(z.string()).describe("希望する会社規模(複数可)"),
});

// ====================================================================
// 診断結果サブスキーマ(career_profile に optional で同梱する)
//
// なぜ career_profile の中?
// - 暗号化境界を 1 つに保ち、ユーザー所有データを一箇所に集約するため。
// - 既存の保存/読み出し経路(saveCareerProfile / getCareerProfile)に乗せられる。
//
// 既存データへの影響:
// - diagnosis は optional。診断未実施の既存 career_profile は変更なしで通る。
// ====================================================================

const axisTypeEnum = z.enum([
  "specialist",
  "management",
  "autonomy",
  "security",
  "entrepreneur",
  "service",
  "challenge",
  "lifestyle",
]);

const aptitudeFactorEnum = z.enum([
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "stability",
]);

// 軸スコア:全 8 タイプを明示的に z.object で固める。
// z.record でも書けるが、欠けたキーで UI が落ちるリスクをスキーマ側で潰す。
const axisScoresSchema = z.object({
  specialist: z.number(),
  management: z.number(),
  autonomy: z.number(),
  security: z.number(),
  entrepreneur: z.number(),
  service: z.number(),
  challenge: z.number(),
  lifestyle: z.number(),
});

const aptitudeScoresSchema = z.object({
  openness: z.number(),
  conscientiousness: z.number(),
  extraversion: z.number(),
  agreeableness: z.number(),
  stability: z.number(),
});

const jobCategoryStoredSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const diagnosisSchema = z.object({
  axis: z.object({
    primary: axisTypeEnum,
    secondary: axisTypeEnum.nullable(),
    scores: axisScoresSchema,
  }),
  aptitude: z.object({
    scores: aptitudeScoresSchema,
    topStrengths: z.array(aptitudeFactorEnum).max(5),
  }),
  jobs: z.object({
    categories: z.array(jobCategoryStoredSchema),
    aptitudeHint: z.string(),
  }),
  explanation: z.string(),
  createdAt: z.string(), // ISO 8601
});

export type StoredDiagnosis = z.infer<typeof diagnosisSchema>;

/**
 * キャリア棚卸し結果の完全な構造
 *
 * diagnosis は optional。既存データ(診断未実施)はそのまま通る。
 */
export const careerProfileSchema = z.object({
  user_facts: userFactsSchema,
  strengths: z.array(strengthSchema).describe("会話から抽出された強み(最大5個)"),
  values: z.array(z.string()).describe("仕事で大切にしている価値観"),
  wants: wantsSchema,
  concerns: z.array(z.string()).describe("懸念点・自信のないこと"),
  summary: z.string().describe("この人物の総評(2-3文、他モジュールが参照する)"),
  diagnosis: diagnosisSchema.optional().describe("キャリア診断の結果(任意)"),
});

/**
 * TypeScript型の自動推論
 */
export type CareerProfile = z.infer<typeof careerProfileSchema>;
export type Strength = z.infer<typeof strengthSchema>;
export type UserFacts = z.infer<typeof userFactsSchema>;
export type Wants = z.infer<typeof wantsSchema>;
