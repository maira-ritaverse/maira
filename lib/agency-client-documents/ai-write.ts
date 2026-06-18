/**
 * エージェント向け 履歴書 自由記述欄(志望動機 / 自己 PR)の AI 生成。
 *
 * seeker 側 lib/ai/prompts/document-writer.ts の DOCUMENT_PROMPTS を参考に、
 * エージェント業務の文脈(ヒアリングシート と クライアント基本情報)から
 * 書き起こすバージョン。
 *
 * 入力:
 *   ・クライアント名 + 既存履歴書の PII の一部(motivation / self_pr / 学歴)
 *   ・最新のヒアリングシート(なくても可)
 *   ・kind: "motivation" | "self_pr"
 *
 * 出力:
 *   ・400-450 字(motivation)/ 300-350 字(self_pr)
 *
 * 設計判断:
 *   ・既存値があれば「(既存)」として LLM に渡し、リライト先に役立てる
 *   ・架空の数値・社名は禁止。ヒアリング 不明箇所は (別途記入) と書かせる
 */
import { generateText } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";

import type { AgencyClientResume } from "./types";
import type { HearingSheetContent } from "./types";

export type AiWriteKind = "motivation" | "self_pr" | "cv_summary" | "cv_body";

const COMMON_RULES = `
# 共通ルール
1. ヒアリング内容と履歴書既存項目に書かれていない事実(数値・社名・受賞歴等)を勝手に作らない。
2. 自画自賛(「素晴らしい成果」「卓越した能力」)は使わない。事実+成果を具体的に書く。
3. 採用担当者の視点で書く。要点を先に、抽象論より具体的なエピソード。
4. 不足情報は「(別途記入)」と明記する。
5. 出力は本文のみ。前置き・見出し・箇条書き・解説は禁止。文章は自然な日本語の段落形式。
`;

const SYSTEM_MOTIVATION = `あなたは中途採用支援に長けたキャリアアドバイザーです。
履歴書の自由記述欄(志望動機)の本文を 400-450 字で 1 つの段落として作成します。

# 出力要件
- 400-450 字。厳守。
- 「貴社」で統一(書面体)。
- 構成(段落内で自然に):
  ① なぜこの会社・職種に関心があるか(具体要素を引用)
  ② 自分のどの経験/強みが活きるか(エビデンス込み)
  ③ 入社後にやりたいこと・貢献したいこと

${COMMON_RULES}`;

const SYSTEM_SELF_PR = `あなたは中途採用支援に長けたキャリアアドバイザーです。
履歴書の自由記述欄(自己 PR)の本文を 300-350 字で 1 つの段落として作成します。

# 出力要件
- 300-350 字。厳守。
- 1 つの強みに焦点を絞る(複数を羅列しない)。
- 構成(段落内で自然に):
  ① 強みの宣言
  ② 具体的なエピソード(状況・行動・結果)
  ③ その強みを活かしてどう貢献するか

${COMMON_RULES}
- 「コミュニケーション能力」のような曖昧な強みは避ける。
`;

const SYSTEM_CV_SUMMARY = `あなたは中途採用支援に長けたキャリアアドバイザーです。
職務経歴書の冒頭「要約」(キャリアサマリ)を 300-500 字で作成します。

# 出力要件
- 300-500 字。
- 「経験年数 / 主業界 / 主担当 / 強み / 成果」を含める段落形式。
- 採用担当者が 30 秒で「合うかどうか」判断できる凝縮度。

${COMMON_RULES}`;

const SYSTEM_CV_BODY = `あなたは中途採用支援に長けたキャリアアドバイザーです。
職務経歴書の本文(職務経歴 + 自己 PR を含む長文)を作成します。

# 出力要件
- 全体で 1500-3000 字程度。
- 構成は段落と空行で整える(箇条書きの羅列は最小限)。下記のセクション順:
  【職務経歴】時系列で各社・各案件:期間 / 会社・部署 / 担当 / 業務内容 / 実績
  【技術スタック / スキル】使用技術・ツールを軽くまとめる(任意)
  【自己 PR】強みと貢献意欲を 1 段落で
- 不明な期間 / 会社名は (別途記入) と明示する

${COMMON_RULES}`;

function buildUserPrompt(args: {
  clientName: string;
  resume: AgencyClientResume;
  hearing: HearingSheetContent | null;
  kind: AiWriteKind;
}): string {
  const { clientName, resume, hearing, kind } = args;
  const lines: string[] = [
    `【依頼種別】${kind === "motivation" ? "志望動機" : "自己 PR"}`,
    "",
    `【クライアント名】${clientName}`,
    "",
    "【ヒアリング内容(直近)】",
    hearing
      ? JSON.stringify(
          {
            現職: hearing.current_job,
            強み: hearing.strengths,
            弱み: hearing.weaknesses,
            希望業種: hearing.desired_industry,
            希望職種: hearing.desired_position,
            希望勤務地: hearing.desired_location,
            希望年収: hearing.desired_salary,
            転職理由: hearing.job_change_reason,
            動機: hearing.motivation,
            入社可能時期: hearing.availability,
            メモ: hearing.notes,
          },
          null,
          2,
        )
      : "(ヒアリングシート未作成)",
    "",
    "【履歴書既存項目】",
    JSON.stringify(
      {
        既存_志望動機: resume.pii.motivation,
        既存_自己PR: resume.pii.self_pr,
        本人希望: resume.pii.preferences,
        学歴_職歴: resume.educationHistory,
        資格: resume.licenses,
      },
      null,
      2,
    ),
    "",
    "上記を踏まえて、本文のみを段落形式で書いてください。",
  ];
  return lines.join("\n");
}

function systemFor(kind: AiWriteKind): string {
  switch (kind) {
    case "motivation":
      return SYSTEM_MOTIVATION;
    case "self_pr":
      return SYSTEM_SELF_PR;
    case "cv_summary":
      return SYSTEM_CV_SUMMARY;
    case "cv_body":
      return SYSTEM_CV_BODY;
  }
}

export async function generateResumeText(args: {
  clientName: string;
  resume: AgencyClientResume;
  hearing: HearingSheetContent | null;
  kind: AiWriteKind;
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const system = systemFor(args.kind);
  const prompt = buildUserPrompt(args);
  return runClaude(system, prompt);
}

/**
 * 職務経歴書 単体(履歴書なし)用の AI 生成。
 * cv_summary / cv_body のみ対応。
 */
export async function generateCvText(args: {
  clientName: string;
  hearing: HearingSheetContent | null;
  kind: "cv_summary" | "cv_body";
  /** 既存の summary / body(差分リライト用、空でもよい) */
  existing: { summary: string; body: string };
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const system = systemFor(args.kind);
  const lines: string[] = [
    `【依頼種別】${args.kind === "cv_summary" ? "職務経歴書 要約" : "職務経歴書 本文"}`,
    "",
    `【クライアント名】${args.clientName}`,
    "",
    "【ヒアリング内容(直近)】",
    args.hearing
      ? JSON.stringify(
          {
            現職: args.hearing.current_job,
            強み: args.hearing.strengths,
            弱み: args.hearing.weaknesses,
            希望業種: args.hearing.desired_industry,
            希望職種: args.hearing.desired_position,
            希望勤務地: args.hearing.desired_location,
            希望年収: args.hearing.desired_salary,
            転職理由: args.hearing.job_change_reason,
            動機: args.hearing.motivation,
            入社可能時期: args.hearing.availability,
            メモ: args.hearing.notes,
          },
          null,
          2,
        )
      : "(ヒアリングシート未作成)",
    "",
    "【既存職務経歴書】",
    JSON.stringify({ 既存_要約: args.existing.summary, 既存_本文: args.existing.body }, null, 2),
    "",
    "上記を踏まえて、本文のみを段落形式で書いてください。",
  ];
  return runClaude(system, lines.join("\n"));
}

async function runClaude(
  system: string,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const completion = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system,
      prompt,
    });
    const text = completion.text.trim();
    if (!text) return { ok: false, reason: "AI から空のレスポンスが返りました" };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
