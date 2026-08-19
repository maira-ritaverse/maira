import type { CareerProfile } from "@/lib/career/profile-schema";
import type { InterviewPrepContent } from "@/lib/interview-preps/types";

/**
 * 面接対策(エージェント → 候補者)生成プロンプト。
 *
 * 役割:
 *   ・特定の候補者(career_profile)× 特定の求人(job_posting)に対して、
 *     エージェントが候補者を送り出す前の「面接対策メモ」を生成する。
 *   ・企業研究の着眼点・評価される観点・想定質問と回答の方向性・
 *     志望動機/キャリアビジョンの組み立て・逆質問/好印象のコツ・
 *     この候補者が特に準備すべき点を、実務で使える粒度でまとめる。
 *
 * 虚偽・捏造防止(重要):
 *   ・面接官名・面接日時・会場・具体的な社内事情など、求人情報から確定できない
 *     事実は創作しない。分からないことは「事前に調べておくべき点」として提示する。
 *   ・候補者の経歴も career_profile の範囲を超えて捏造しない。
 *
 * 出力:厳密な JSON(sections 配列)。パースは parseInterviewPrepOutput で行う。
 */

/** 生成させるセクション(見出し)を固定し、順序と粒度を安定させる。 */
const SECTION_HEADINGS = [
  "この企業・求人を研究するポイント",
  "選考で評価される観点",
  "想定される面接の流れ",
  "想定される質問と回答の方向性",
  "志望動機・キャリアビジョンの組み立て",
  "逆質問・好印象を残すコツ",
  "この候補者が特に準備・注意すべき点",
] as const;

const INTERVIEW_PREP_SYSTEM = `あなたは、転職エージェントのベテランキャリアアドバイザーです。
担当する候補者が、ある求人企業の面接に臨む前に渡す「面接対策メモ」を作成します。

# 目的
候補者がその面接で実力を最大限に発揮できるよう、企業研究の着眼点・評価されるポイント・
想定質問と回答の方向性・志望動機やキャリアビジョンの組み立て方を、実務で使える具体性で
まとめる。候補者本人の経歴(強み・価値観・志向)を踏まえて、その人に合った準備を示す。

# 絶対に守るルール(捏造防止)
1. 求人情報から確定できない事実を創作しない:
   - 面接官の氏名・役職、面接日時、会場、選考回数などを断定しない
   - 企業の売上・従業員数・具体的な社内制度などを勝手に断定しない
   - 分からないことは「事前に確認・調査しておくべき点」として書く
2. 候補者の経歴を career_profile の範囲を超えて創作しない
   - 在籍企業名・数値実績・資格などを勝手に足さない
3. 一般論に逃げず、この求人・この候補者に即した内容にする
   - 求人の required_skills / description と候補者の strengths を結びつけて助言する
4. 断定できない推測には「〜と考えられます」「〜の可能性があります」と明示する

# 出力形式(厳守)
必ず次の JSON だけを出力する(前後に説明文・コードフェンス・マークダウンを付けない):
{
  "sections": [
    { "heading": "見出し", "items": ["箇条書き1", "箇条書き2", ...] }
  ]
}
- sections は次の見出しを、この順序で必ず含める(過不足なく 7 つ):
${SECTION_HEADINGS.map((h) => `  - ${h}`).join("\n")}
- 各 section の items は 3〜6 個。1 項目は 1〜3 文の簡潔な日本語。
- items 内でマークダウン記法(**, #, - 等)は使わない。プレーンテキストで書く。
- 日本語。半角スペースで単語を区切らない(例:「保存 中」ではなく「保存中」)。`;

export type InterviewPrepPromptJob = {
  companyName: string;
  position: string;
  employmentType: string | null;
  location: string | null;
  description: string | null;
  requiredSkills: string | null;
  preferredSkills: string | null;
  applicationQualifications: string | null;
};

export function buildInterviewPrepPrompt(params: {
  profile: CareerProfile;
  jobPosting: InterviewPrepPromptJob;
  advisorNotes: string | null;
}): { system: string; prompt: string } {
  const { profile, jobPosting, advisorNotes } = params;

  // 候補者情報は面接対策に必要な項目だけ渡す(個人特定情報は渡さない)。
  const candidate = {
    summary: profile.summary,
    strengths: profile.strengths,
    values: profile.values,
    wants: profile.wants,
  };

  const job = {
    company_name: jobPosting.companyName,
    position: jobPosting.position,
    employment_type: jobPosting.employmentType ?? "",
    location: jobPosting.location ?? "",
    description: jobPosting.description ?? "",
    required_skills: jobPosting.requiredSkills ?? "",
    preferred_skills: jobPosting.preferredSkills ?? "",
    application_qualifications: jobPosting.applicationQualifications ?? "",
  };

  const prompt = [
    "以下の候補者と求人の情報をもとに、この候補者向けの面接対策メモを JSON で作成してください。",
    "指定した 7 つのセクションを、指定の順序ですべて含めてください。",
    "",
    "【候補者(キャリア棚卸し結果)】",
    JSON.stringify(candidate, null, 2),
    "",
    "【求人情報】",
    JSON.stringify(job, null, 2),
    "",
    "【エージェントの所感(任意)】",
    advisorNotes && advisorNotes.trim().length > 0 ? advisorNotes.trim() : "(特になし)",
  ].join("\n");

  return { system: INTERVIEW_PREP_SYSTEM, prompt };
}

/**
 * モデル出力(JSON 想定)を InterviewPrepContent に変換する。
 *
 * モデルがコードフェンスや前後の説明文を付けても拾えるよう、最初の `{` から
 * 最後の `}` までを取り出してパースする。失敗したら生テキストを 1 セクションに
 * 収めてフェイルオープンする(UI 側で再生成を促せる)。
 */
export function parseInterviewPrepOutput(rawOutput: string): InterviewPrepContent {
  const text = rawOutput.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      const sections = (parsed as { sections?: unknown })?.sections;
      if (Array.isArray(sections)) {
        const normalized = sections
          .filter(
            (s): s is { heading: unknown; items: unknown } =>
              !!s && typeof s === "object" && "heading" in s && "items" in s,
          )
          .map((s) => ({
            heading: typeof s.heading === "string" ? s.heading.trim() : "",
            items: Array.isArray(s.items)
              ? s.items
                  .filter((i): i is string => typeof i === "string")
                  .map((i) => i.trim())
                  .filter((i) => i.length > 0)
              : [],
          }))
          .filter((s) => s.heading.length > 0 && s.items.length > 0);
        if (normalized.length > 0) return { sections: normalized };
      }
    } catch {
      // フォールバックへ
    }
  }
  // フェイルオープン:生テキストを 1 セクションに収める
  return { sections: [{ heading: "面接対策", items: [text] }] };
}
