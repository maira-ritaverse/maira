import { z } from "zod";

import type { CareerProfile } from "@/lib/career/profile-schema";

/**
 * 応募ごとの「求人特化 PR」を AI で生成するためのプロンプト。
 *
 * 目的:
 *   ユーザは履歴書・職務経歴書を「ベース文書」として 1 本持ち、
 *   応募ごとに自己PR / 志望動機を求人に合わせて差し替えたい。
 *
 *   このプロンプトは 1 回の generateObject で
 *     - resume_self_pr   履歴書用の自己PR(300〜350字)
 *     - cv_self_pr       職務経歴書用の自己PR(300〜500字)
 *     - motivation_note  志望動機(300〜450字)
 *   を同時に生成する。
 *
 *   入力は:
 *     A. キャリア棚卸し結果(CareerProfile)
 *     B. 応募先の求人情報(application.encrypted_details の中身相当 + 任意の貼付 JD)
 *     C. ベース文書(任意。あればトーンを踏襲、無ければゼロから生成)
 */

// ===== 出力スキーマ(generateObject 用)=====
export const jobTailoredPrSchema = z.object({
  resume_self_pr: z
    .string()
    .min(50)
    .max(3000)
    .describe("履歴書用の自己PR。300〜350字。プレーンテキスト。マークダウン記法不可。"),
  cv_self_pr: z
    .string()
    .min(50)
    .max(2000)
    .describe("職務経歴書用の自己PR。300〜500字。プレーンテキスト。マークダウン記法不可。"),
  motivation_note: z
    .string()
    .min(50)
    .max(2000)
    .describe("この応募の志望動機。300〜450字。プレーンテキスト。マークダウン記法不可。"),
});

export type JobTailoredPr = z.infer<typeof jobTailoredPrSchema>;

// ===== 入力型 =====
/** 応募先の求人情報(applications.encrypted_details 由来 + UI 上の補足) */
export type JobContext = {
  company: string;
  position: string;
  jobUrl?: string | null;
  notes?: string | null;
  salaryRange?: string | null;
  location?: string | null;
  /** UI で追加で貼った JD テキスト(あれば最優先のソース) */
  jdExtra?: string | null;
};

/** ベース文書(任意。空でも可) */
export type BasePrInputs = {
  baseResumeSelfPr?: string | null;
  baseCvSelfPr?: string | null;
  baseMotivation?: string | null;
};

// ===== システムプロンプト =====
//
// 出力 3 種それぞれの規格と、自画自賛・捏造・固有名詞露出を防ぐルールをまとめている。
// ベース文書がある場合とゼロからの場合の両方を扱えるようにしている。
const SYSTEM = `あなたは転職活動の応募書類カスタマイズの専門家です。
求職者の「キャリア棚卸し結果」と、応募する「求人情報」、そして既存のベース文書を元に、
この求人に最適化された 3 つの文章(履歴書の自己PR / 職務経歴書の自己PR / 志望動機)を
同時に生成してください。

# 出力する 3 つの文章

## (1) resume_self_pr — 履歴書用の自己PR
- 300〜350字。1〜2 段落。
- 採用担当が短時間で読める、要点先出しの構成。
- 求人の「職種」「必須スキル」と直接マッチする強みを 1〜2 点に絞る。

## (2) cv_self_pr — 職務経歴書用の自己PR
- 300〜500字。1〜2 段落。
- 強みを 2〜3 点、それぞれに棚卸しの evidence を 1〜2 文の具体例で添える。
- 価値観(values)を 1 点だけ働き方の方針として軽く触れる。
- 締めは「今後も〜したい」の前向きな展望(求人企業に向けた表現で構わない)。

## (3) motivation_note — 志望動機
- 300〜450字。
- 「なぜこの企業・職種か」(求人情報の具体要素に触れる)→「自分の経験/強みが活きる」→
  「入社後の貢献」の順。
- 求人に書かれていない情報(企業沿革、CEO の発言など)は使わない。書かれた範囲だけで構成する。

# 守るルール(全文共通)
- 棚卸し結果(strengths / values / summary)に書かれた事実のみ使う。経験を盛らない、捏造しない。
- ベース文書がある場合は「言い回しのトーン」「主張する強みの選び方」を踏襲しつつ、
  求人に合わせて並べ替え・絞り込み・強調を調整する。
- ベース文書が空または null の場合は棚卸しを元にゼロから生成して構わない。
- 求人の必須条件・歓迎条件(JD)に触れる場合は、棚卸しの evidence と紐付けて根拠を示す
  (根拠なしに「対応できます」と言い切らない)。
- 「貴社」「御社」は文書では「貴社」を使う(志望動機の口語場面のみ「御社」可)。
- 「素晴らしい成果を残しました」のような自画自賛は書かない。
- 固有名詞(前職の会社名など)は伏せて「前職で」「これまでの業務で」に言い換える。
- マークダウン記法(**, ##, [], 箇条書きの - 等)は使わない。プレーンテキスト。
- 「以下が下書きです:」のような枕詞は出力に含めない(本文のみ返す)。`;

// ===== プロンプト構築関数 =====
/**
 * 求人特化 PR 生成プロンプトを組み立てる。
 *
 * - 棚卸しは strengths / summary / values / user_facts を渡す
 *   (wants/concerns は応募側の文章では不要)
 * - 求人は applications.encrypted_details に対応する 6 項目 + jdExtra
 * - ベース文書は任意(無ければ null)
 */
export function buildJobTailoredPrPrompt(input: {
  profile: CareerProfile;
  job: JobContext;
  base?: BasePrInputs;
}): { system: string; prompt: string } {
  const { profile, job, base } = input;

  const relevant = {
    user_facts: profile.user_facts,
    summary: profile.summary,
    strengths: profile.strengths,
    values: profile.values,
  };

  const jobInfo = {
    company_name: job.company,
    position: job.position,
    job_url: job.jobUrl ?? null,
    salary_range: job.salaryRange ?? null,
    location: job.location ?? null,
    notes: job.notes ?? null,
    // UI で貼り付けた JD は「最も信頼できる詳細情報」として AI に明示
    jd_extra: job.jdExtra ?? null,
  };

  const baseDocs = {
    resume_self_pr: base?.baseResumeSelfPr ?? null,
    cv_self_pr: base?.baseCvSelfPr ?? null,
    motivation_note: base?.baseMotivation ?? null,
  };

  return {
    system: SYSTEM,
    prompt: [
      "以下は (A) 棚卸し結果、(B) 応募する求人の情報、(C) ベース文書 です。",
      "(A) の範囲だけを根拠に、求人 (B) に最適化した 3 つの文章を生成してください。",
      "(C) のベース文書は『トーン』と『主張する強みの傾向』を踏襲する材料です。null なら",
      "棚卸しからゼロベースで生成して構いません。",
      "",
      "【A. 棚卸し結果】",
      JSON.stringify(relevant, null, 2),
      "",
      "【B. 応募する求人】",
      JSON.stringify(jobInfo, null, 2),
      "",
      "【C. ベース文書(任意・参考)】",
      JSON.stringify(baseDocs, null, 2),
    ].join("\n"),
  };
}
