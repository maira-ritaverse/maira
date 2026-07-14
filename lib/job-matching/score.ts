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
 * AI 推薦 の 重み付け プリセット。
 * ・fit_focused (既定): 求職者 フィット 最優先。 placement_fee は プロンプト に 一切 出さない
 * ・balanced:            fit が 主軸、 fee は 副次的 な 参考 情報
 * ・fee_focused:         fee を 強く 重視、 ただし fit の 最低ライン は 保つ
 */
export type FeePreset = "fit_focused" | "balanced" | "fee_focused";

/**
 * Claude に投げるプロンプト本文を作る。
 *
 * 出力の最後で「**JSON だけを返してください**」と強く指示する。
 * 出力が長くなり過ぎないよう、各求人の description は 600 文字に切り詰める。
 *
 * feePreset が "balanced" / "fee_focused" のとき のみ 各 求人 の placement_fee を
 * プロンプト に 出す。 fee 情報 は エージェント の 内部 情報 で、 求職者 に は 見せない。
 * この 関数 の 出力 (プロンプト テキスト) も サーバー内 の Claude 送信 で 完結し、
 * DB / クライアント に は 保存 されない。
 */
export function buildPrompt(args: {
  client: MatchingClientContext;
  jobs: JobPosting[];
  feePreset?: FeePreset;
}): string {
  const { client, jobs } = args;
  const requestedPreset: FeePreset = args.feePreset ?? "fit_focused";
  // 要求 された preset が fee を 使う 前提 でも、 実際 の 求人 に fee 値 が 1 件 も
  // 無い 場合 は fit_focused に フォールバック する。 Claude に 「fee を 考慮せよ」 と
  // 指示 しつつ 値 を 渡さ ない 状態 を 防ぐ (求職者 経路 で 起き 得る)。
  const anyJobHasFee = jobs.some((j) => j.placementFee != null);
  const feePreset: FeePreset =
    requestedPreset !== "fit_focused" && anyJobHasFee ? requestedPreset : "fit_focused";
  const includeFee = feePreset !== "fit_focused";
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
      // 成約報酬 は preset が balanced / fee_focused の ときだけ プロンプト に 載せる。
      // 未設定 (null) の 求人 は 情報 を 出さない (推測 させない ため)。
      const feeLine =
        includeFee && j.placementFee != null
          ? `- 成約報酬 (エージェント 側 内部 情報 / 求職者 に は 非表示): ${j.placementFee}万円`
          : null;
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
        feeLine,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  // preset 別 の 追加指示。 fee 情報 を どの くらい 重視 する か を 明文化。
  const rankingCriteria = (() => {
    if (feePreset === "fee_focused") {
      return [
        "ランキング基準 (プリセット: 成約報酬 重視):",
        "- **成約報酬 が 高い 求人 を 優先** して 上位 に する。 ただし fit の 最低ライン (求職者 の 業界 / 職種 希望 と の 整合) は 必ず 保つ",
        "- 求職者 の 強み / 診断結果 と 求人内容 の 相性",
        "- 希望条件 (業界 / 職種 / 年収 / 勤務地 / 企業規模) の 整合性",
      ].join("\n");
    }
    if (feePreset === "balanced") {
      return [
        "ランキング基準 (プリセット: バランス):",
        "- 求職者 の 強み / 診断結果 と 求人内容 の 相性 (最優先)",
        "- 希望条件 (業界 / 職種 / 年収 / 勤務地 / 企業規模) の 整合性",
        "- 同 程度 の fit で 迷ったら 成約報酬 が 高い 方 を 上位 に する (副次的 な タイブレーカー)",
        "- 求職者 に とって 挑戦 に なり すぎ ない が 成長機会 が 十分 に ある か",
      ].join("\n");
    }
    // fit_focused (既定): 従来 と 同じ 挙動。 fee 情報 は プロンプト に 出て いない ので 使われない
    return [
      "ランキング基準:",
      "- 求職者の強み・診断結果と求人内容の相性",
      "- 希望条件(業界・職種・年収・勤務地・企業規模)の整合性",
      "- 求職者にとって挑戦になりすぎないが成長機会が十分にあるか",
    ].join("\n");
  })();

  return [
    "あなたは日本の転職市場に精通したキャリアアドバイザーです。",
    "求職者のプロフィール(キャリア棚卸し・診断結果・希望条件)と、エージェントが扱う求人一覧を踏まえ、",
    "**マッチ度が高い順に最大 5 件**まで JSON で返してください。",
    "",
    rankingCriteria,
    "",
    "rationale は **120 文字以内の日本語** で「なぜマッチするか」を簡潔に。",
    "未入力項目は推測せず、根拠が薄い場合はその旨も含めて率直に書く。",
    "",
    "重要(プライバシー):",
    "rationale には **求職者の診断結果に含まれる軸名や適性因子名(例: challenge, openness 等)、",
    "または「あなた」「ご本人」の表記は使わないでください**。「分析的思考」「対人志向」のような",
    "一般的な日本語表現に変換して書いてください。",
    includeFee
      ? "また、 **rationale に 「成約報酬」「報酬額」「fee」 など 金額 の 話 は 一切 書か ない でください**。 fee 情報 は 上位 判定 の 内部 参考 のみ に 使い、 rationale は 求職者 に とっての メリット だけ を 書く。"
      : null,
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
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/**
 * 求職者向け rationale の 事後 サニタイズ。
 *
 * プロンプト で 「rationale に 報酬 / fee 情報 を 書か ない で」 と 指示 して いる が、
 * LLM が 指示 を 無視 する 可能 性 が ある ため 事後 チェック として 用意 する。
 * ヒット した rationale は 安全 な 汎用 文言 で 置き換え、 サーバー に warn ログ を 残す。
 *
 * 対象 パターン:
 *   ・「報酬」 (成約報酬 / 報酬額 / 報酬 単独)
 *   ・「フィー」
 *   ・「fee」 単語 (英字 大小)
 *   ・「placement fee」 「placement_fee」
 *
 * "万円" は 年収 (salary) の 文脈 で 頻出 する ため 意図的 に 判定 対象 に 含めない。
 * これ は 求職者 経路 で のみ 呼ぶ 純関数 (agency 経路 で は 使わ ない)。
 */
const SEEKER_RATIONALE_MONEY_PATTERN = /報酬|フィー|placement[_ ]?fee|\bfee\b/i;
const SEEKER_SAFE_FALLBACK_RATIONALE =
  "ご希望と 求人内容 の 相性 が 高い ため、 上位 に お勧め します。";

export function sanitizeSeekerRationale(rationale: string): {
  rationale: string;
  redacted: boolean;
} {
  if (SEEKER_RATIONALE_MONEY_PATTERN.test(rationale)) {
    return { rationale: SEEKER_SAFE_FALLBACK_RATIONALE, redacted: true };
  }
  return { rationale, redacted: false };
}

/**
 * 入力データのハッシュ。キャリアプロフィール更新時刻 + open 求人 ID/更新時刻 から算出。
 * 同じ入力なら必ず同じ値、どれかが変わったら値が変わる。
 *
 * feePreset を 含める ことで、 admin が プリセット を 切り替えた ときに キャッシュ が
 * 自動 で 陳腐化 し 次回 fetch 時 に 再 生成 される。
 *
 * placement_fee 自体 は 求人 の updated_at で 拾える (更新 時 に updated_at が 動く 前提)。
 */
export function computeInputsHash(args: {
  careerProfileUpdatedAt: string | null;
  clientUpdatedAt: string;
  jobs: ReadonlyArray<{ id: string; updated_at: string }>;
  feePreset?: FeePreset;
}): string {
  const sorted = [...args.jobs].sort((a, b) => a.id.localeCompare(b.id));
  const payload = JSON.stringify({
    p: args.careerProfileUpdatedAt ?? "",
    c: args.clientUpdatedAt,
    j: sorted.map((j) => `${j.id}:${j.updated_at}`),
    // 未指定 (undefined) と "fit_focused" を 同じ hash に する ため 明示的 に 既定 に 揃える
    fp: args.feePreset ?? "fit_focused",
  });
  return createHash("sha256").update(payload).digest("hex");
}
