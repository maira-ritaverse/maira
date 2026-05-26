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

/**
 * キャリア棚卸し結果の完全な構造
 */
export const careerProfileSchema = z.object({
  user_facts: userFactsSchema,
  strengths: z.array(strengthSchema).describe("会話から抽出された強み(最大5個)"),
  values: z.array(z.string()).describe("仕事で大切にしている価値観"),
  wants: wantsSchema,
  concerns: z.array(z.string()).describe("懸念点・自信のないこと"),
  summary: z.string().describe("この人物の総評(2-3文、他モジュールが参照する)"),
});

/**
 * TypeScript型の自動推論
 */
export type CareerProfile = z.infer<typeof careerProfileSchema>;
export type Strength = z.infer<typeof strengthSchema>;
export type UserFacts = z.infer<typeof userFactsSchema>;
export type Wants = z.infer<typeof wantsSchema>;
