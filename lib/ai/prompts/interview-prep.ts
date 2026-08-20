import type { InterviewPrepContent } from "@/lib/interview-preps/types";

/**
 * 面接対策(エージェント → 候補者)生成プロンプト。
 *
 * 役割:
 *   ・特定の候補者 × 特定の求人に対して、エージェントが候補者を送り出す前の
 *     「面接対策メモ」を生成する。
 *   ・候補者情報は「求職者本人のキャリア棚卸し」ではなく、エージェントが CRM に
 *     入力したプロフィール(client_records)を主な根拠にする。棚卸しは不要。
 *   ・企業研究の着眼点・評価される観点・想定質問と回答の方向性・志望動機/キャリア
 *     ビジョンの組み立て・逆質問/好印象のコツ・特に準備すべき点を、実務で使える
 *     粒度でまとめる。
 *
 * ハルシネーション(虚偽・捏造)防止 ── 本機能の最重要要件:
 *   ・AI は Web を閲覧できない。求人票に書かれていない「その企業固有の事実」
 *     (財務・従業員数・沿革・具体的な社風・制度・実績・受賞歴・経営者名など)を
 *     断定しない。知っているつもりでも古い/誤りの可能性があるため事実として書かない。
 *   ・一般的な業界・職種の知識として述べる場合は「一般に〜の傾向があります」と明示し、
 *     この企業固有の事実として書かない。企業固有の点は「面接前に調べる/逆質問で
 *     確認する」項目として提示する。
 *   ・候補者についても、提供された情報の範囲を超えて経歴・数値・資格などを創作しない。
 *   ・情報が乏しい場合は、無理に個別化せず、求人要件から導ける一般的な準備に寄せる。
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
まとめる。候補者の情報(エージェントが把握している範囲)を踏まえ、その人に合った準備を示す。

# 絶対に守るルール(ハルシネーション=虚偽・捏造の防止。最重要)
1. あなたは Web を閲覧できない。求人票に書かれていない「その企業固有の事実」を断定しない:
   - 財務状況・売上・従業員数・沿革・資本金・具体的な社内制度・福利厚生の詳細
   - 具体的な社風・文化・離職率・評価制度・研修制度の詳細
   - 受賞歴・取引先・シェア・経営者名・面接官名・選考回数・面接日時・会場
   これらは「知っているつもり」でも古い/誤りの可能性があるため、事実として書かない。
2. 一般的な業界・職種の知識は使ってよいが、必ず「一般に〜の傾向があります」「業界的には
   〜が多いです」と一般論であることを明示し、この企業固有の事実として断定しない。
3. 企業固有で確認が必要なことは、断定せずに「面接前に公式サイト/求人票/口コミで調べる」
   「逆質問で確認する」項目として提示する(=調べ方・確認の仕方を教える)。
4. 候補者情報は提供された範囲だけを根拠にする。在籍企業名・数値実績・資格・経歴などを
   勝手に足さない。空欄・未入力の項目は無いものとして扱い、創作で埋めない。
5. 情報が乏しいときは、無理に個別化せず、求人の要件・職種から導ける一般的な準備に寄せる
   (それでも十分に価値のある内容になる)。
6. 断定できない推測には「〜と考えられます」「〜の可能性があります」と明示する。

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

/**
 * 面接対策プロンプトを構築する。
 *
 * candidate は「エージェントが把握している候補者情報」を、空でない項目だけ詰めた
 * オブジェクト(呼出側=API ルートで client_records から組み立てる)。棚卸し(career_profile)
 * があればそれも候補者情報にマージして渡してよい。空 = 情報が乏しい前提で一般準備に寄せる。
 */
export function buildInterviewPrepPrompt(params: {
  candidate: Record<string, unknown>;
  jobPosting: InterviewPrepPromptJob;
  advisorNotes: string | null;
}): { system: string; prompt: string } {
  const { candidate, jobPosting, advisorNotes } = params;

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

  const hasCandidateInfo = Object.keys(candidate).length > 0;

  const prompt = [
    "以下の候補者情報と求人情報をもとに、この候補者向けの面接対策メモを JSON で作成してください。",
    "指定した 7 つのセクションを、指定の順序ですべて含めてください。",
    "候補者情報は下記の範囲だけを根拠にし、書かれていないことは創作しないでください。",
    "求人票に無い企業固有の事実は断定せず、一般論として述べるか、調べるべき点として提示してください。",
    "",
    "【候補者について分かっている情報(エージェントが把握している範囲)】",
    hasCandidateInfo
      ? JSON.stringify(candidate, null, 2)
      : "(詳細情報が乏しいため、求人の要件・職種から導ける一般的な面接準備を中心に提示してください)",
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
