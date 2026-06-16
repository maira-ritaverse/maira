/**
 * AI 求人推薦のプロンプト構築 + 出力パース(純関数)
 *
 * - DB アクセスや AI 呼び出しはしない(テストしやすさのため切り出し)
 * - 呼び出し側で `generateText` を呼んで本関数の戻り値で組み立てる
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import type { CareerProfile } from "@/lib/career/profile-schema";
import type { JobPosting } from "@/lib/jobs/types";

/** AI が返してくる JSON の zod スキーマ。LLM 出力の検証に使う。 */
export const aiRankingSchema = z.object({
  items: z
    .array(
      z.object({
        job_posting_id: z.string().uuid(),
        score: z.number().min(0).max(100),
        rationale: z.string().min(1).max(500),
      }),
    )
    .max(10),
});
export type AiRanking = z.infer<typeof aiRankingSchema>;

/** クライアント情報(マッチング用に抽出された最小サブセット) */
export type MatchingClientContext = {
  /** 表示用の現在ロール / 業界などの自由テキスト */
  currentRole: string | null;
  yearsOfExperience: number | null;
  industry: string | null;
  /** 棚卸し由来 */
  strengths: string[];
  values: string[];
  wants: {
    industries: string[];
    role_types: string[];
    company_sizes: string[];
  };
  /** 診断結果(任意)」 */
  diagnosis: {
    primaryAxis: string | null;
    secondaryAxis: string | null;
    topAptitudes: string[];
    jobCategories: string[];
  } | null;
  /** 希望条件(client_records 由来) */
  desiredAnnualIncome: number | null;
  desiredLocations: string[];
};

/**
 * career_profile から「マッチングに使う最小サブセット」を抽出する。
 * 機微情報(内面 / concerns)はプロンプトに載せない。
 */
export function buildClientContextFromProfile(
  profile: CareerProfile | null,
  clientRecord: {
    desired_annual_income: number | null;
    desired_locations: string[] | null;
  },
): MatchingClientContext {
  return {
    currentRole: profile?.user_facts.current_role ?? null,
    yearsOfExperience: profile?.user_facts.years_of_experience ?? null,
    industry: profile?.user_facts.industry ?? null,
    strengths: (profile?.strengths ?? []).map((s) => s.label),
    values: profile?.values ?? [],
    wants: {
      industries: profile?.wants.industries ?? [],
      role_types: profile?.wants.role_types ?? [],
      company_sizes: profile?.wants.company_sizes ?? [],
    },
    diagnosis: profile?.diagnosis
      ? {
          primaryAxis: profile.diagnosis.axis.primary,
          secondaryAxis: profile.diagnosis.axis.secondary,
          topAptitudes: profile.diagnosis.aptitude.topStrengths,
          jobCategories: profile.diagnosis.jobs.categories.map((c) => c.name),
        }
      : null,
    desiredAnnualIncome: clientRecord.desired_annual_income,
    desiredLocations: clientRecord.desired_locations ?? [],
  };
}

/**
 * Claude に投げるプロンプト本文を作る。
 *
 * 出力の最後で「**JSON だけを返してください**」と強く指示する。
 * 出力が長くなり過ぎないよう、各求人の description は 600 文字に切り詰める。
 */
export function buildPrompt(args: { client: MatchingClientContext; jobs: JobPosting[] }): string {
  const { client, jobs } = args;
  const profileBlock = [
    `# 求職者プロフィール`,
    `- 現職: ${client.currentRole ?? "(未入力)"}`,
    `- 経験年数: ${client.yearsOfExperience ?? "(未入力)"}`,
    `- 現業界: ${client.industry ?? "(未入力)"}`,
    `- 強み: ${client.strengths.length > 0 ? client.strengths.join("、") : "(未抽出)"}`,
    `- 価値観: ${client.values.length > 0 ? client.values.join("、") : "(未抽出)"}`,
    `- 希望業界: ${client.wants.industries.length > 0 ? client.wants.industries.join("、") : "(未指定)"}`,
    `- 希望職種: ${client.wants.role_types.length > 0 ? client.wants.role_types.join("、") : "(未指定)"}`,
    `- 希望企業規模: ${client.wants.company_sizes.length > 0 ? client.wants.company_sizes.join("、") : "(未指定)"}`,
    `- 希望年収: ${client.desiredAnnualIncome ?? "(未指定)"} ${client.desiredAnnualIncome != null ? "万円" : ""}`,
    `- 希望勤務地: ${client.desiredLocations.length > 0 ? client.desiredLocations.join("、") : "(未指定)"}`,
    client.diagnosis
      ? [
          `- キャリア診断(主軸): ${client.diagnosis.primaryAxis ?? "?"} / 副軸: ${client.diagnosis.secondaryAxis ?? "?"}`,
          `- 適性: ${client.diagnosis.topAptitudes.join("、")}`,
          `- 推奨職種カテゴリ: ${client.diagnosis.jobCategories.join("、")}`,
        ].join("\n")
      : `- キャリア診断: (未実施)`,
  ].join("\n");

  const jobsBlock = jobs
    .map((j, i) => {
      const salary =
        j.salaryMin != null && j.salaryMax != null
          ? `${j.salaryMin}-${j.salaryMax}万円`
          : j.salaryMin != null
            ? `${j.salaryMin}万円〜`
            : j.salaryMax != null
              ? `〜${j.salaryMax}万円`
              : "(年収未公開)";
      const desc = (j.description ?? "").slice(0, 600);
      return [
        `## 求人 ${i + 1}`,
        `- id: ${j.id}`,
        `- 会社: ${j.companyName}`,
        `- ポジション: ${j.position}`,
        j.location ? `- 勤務地: ${j.location}` : null,
        j.employmentType ? `- 雇用形態: ${j.employmentType}` : null,
        `- 想定年収: ${salary}`,
        j.requiredSkills ? `- 必須スキル: ${j.requiredSkills.slice(0, 300)}` : null,
        j.preferredSkills ? `- 歓迎スキル: ${j.preferredSkills.slice(0, 300)}` : null,
        desc ? `- 概要: ${desc}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    "あなたは日本の転職市場に精通したキャリアアドバイザーです。",
    "求職者のプロフィール(キャリア棚卸し・診断結果・希望条件)と、エージェントが扱う求人一覧を踏まえ、",
    "**マッチ度が高い順に最大 5 件**まで JSON で返してください。",
    "",
    "ランキング基準:",
    "- 求職者の強み・診断結果と求人内容の相性",
    "- 希望条件(業界・職種・年収・勤務地・企業規模)の整合性",
    "- 求職者にとって挑戦になりすぎないが成長機会が十分にあるか",
    "",
    "rationale は **120 文字以内の日本語** で「なぜマッチするか」を簡潔に。",
    "未入力項目は推測せず、根拠が薄い場合はその旨も含めて率直に書く。",
    "",
    "重要(プライバシー):",
    "rationale には **求職者の診断結果に含まれる軸名や適性因子名(例: challenge, openness 等)、",
    "または「あなた」「ご本人」の表記は使わないでください**。「分析的思考」「対人志向」のような",
    "一般的な日本語表現に変換して書いてください。",
    "",
    profileBlock,
    "",
    "# 求人一覧",
    jobsBlock,
    "",
    "# 出力フォーマット(これ以外何も返さないこと)",
    "```json",
    `{ "items": [ { "job_posting_id": "<上記 id をそのまま>", "score": 0-100 の整数, "rationale": "日本語120字以内" }, ... ] }`,
    "```",
  ].join("\n");
}

/**
 * 入力データのハッシュ。キャリアプロフィール更新時刻 + open 求人 ID/更新時刻 から算出。
 * 同じ入力なら必ず同じ値、どれかが変わったら値が変わる。
 */
export function computeInputsHash(args: {
  careerProfileUpdatedAt: string | null;
  clientUpdatedAt: string;
  jobs: ReadonlyArray<{ id: string; updated_at: string }>;
}): string {
  const sorted = [...args.jobs].sort((a, b) => a.id.localeCompare(b.id));
  const payload = JSON.stringify({
    p: args.careerProfileUpdatedAt ?? "",
    c: args.clientUpdatedAt,
    j: sorted.map((j) => `${j.id}:${j.updated_at}`),
  });
  return createHash("sha256").update(payload).digest("hex");
}
