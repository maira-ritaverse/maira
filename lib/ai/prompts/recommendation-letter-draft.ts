import type { CareerProfile } from "@/lib/career/profile-schema";

/**
 * 推薦文(エージェント → 求人企業)ドラフト生成プロンプト
 *
 * 役割:
 *   ・候補者の career_profile + 求人情報 + エージェント所感を入力に、
 *     求人企業に提出する正式な推薦状の下書きを生成する。
 *   ・推薦者は「弊社(エージェント)」、宛先は「貴社採用ご担当者様」。
 *
 * 重要な設計判断:
 *   ・テンプレ(prefix_body / suffix_body)は AI に渡さない。
 *     → AI が定型句を書き換えるリスクを避け、組織としての公式表現の
 *        一貫性を保つ。連結はレンダリング層(プレビュー / PDF / コピー)で行う。
 *   ・出力は「1 行目: 件名: <見出し>、空行、本文」の固定形式。
 *     サーバ側で正規表現により headline / body に分離する。
 *
 * 虚偽記載防止:
 *   ・推薦文は採用判断に使われる公式文書であり、虚偽記載は候補者と
 *     エージェント双方の信用毀損につながる。career_profile に無い情報の
 *     創作は固く禁じる。resume-draft.ts の流儀を踏襲。
 */

const ANTI_FABRICATION_RULES = `
# 絶対に守るルール(虚偽記載防止)

1. **career_profile に無い情報を絶対に創作しない**:
   - 在籍企業名・在籍年数・学校名・学位を勝手に書かない
   - 資格名(TOEIC スコア、保有資格など)を勝手に書かない
   - 売上金額・人数・年数などの具体的数値を捏造しない
   - 受賞歴・表彰歴を創作しない
   - プロジェクト名・顧客名などの固有名詞を捏造しない

2. **棚卸し結果と求人情報の事実だけで構成する**:
   - candidate.summary / strengths / values / wants を本人の実績として再構成
   - 強みの evidence は具体例として活かしてよいが、固有名詞は伏せる
     (例:「○○社で」→「前職で」「これまでの業務で」)
   - 求人 required_skills のうち、candidate.strengths と対応するものだけ言及
     対応しない skill には触れない(無理に「学ぶ意欲がある」等で繋がない)

3. **自画自賛・誇張・弱気表現を避ける**:
   - 「卓越した」「比類なき」等の誇張表現は使わない
   - 「未熟ですが」「至らぬ点もありますが」等の弱気表現は使わない
   - 事実 + 取り組み + 学び の順で淡々と書く

4. **個人情報の取り扱い**:
   - 本文に候補者の本名・連絡先・年齢を書かない
     (これらは推薦状本体とは別のレイアウト領域で扱う)
   - 性別・国籍・宗教等の差別につながる属性は記載しない

5. **情報が足りないとき**:
   - 創作で穴埋めしない
   - 提供された情報の範囲だけで書ける分だけ書く`;

const RECOMMENDATION_LETTER_SYSTEM = `あなたは、転職エージェントが求人企業に提出する正式な
推薦状(推薦文)の下書きを作成するアシスタントです。

# 役割設定
- 推薦者:転職エージェント企業(本文中の一人称は「弊社」)
- 宛先:求人企業の採用ご担当者様(二人称は「貴社」)
- 推薦対象:候補者(キャリア棚卸し済の求職者)

# このタスクで生成するもの
求人企業に提出する正式な推薦状の本文(拝啓〜敬具 形式の手紙文)。

# 文字数
本文は 400〜800 字程度。簡潔で読みやすく。

# 構成(本文の段落構成)
1. 導入:推薦の意思表明と簡潔な候補者紹介(2〜3 文)
2. 推薦理由:求人 required_skills と candidate.strengths の事実ベースの対応付け
3. 人物像:candidate.values / wants から、組織との適合性を示す要素
4. 結び:選考の機会を依頼する丁寧な締めくくり

# 出力形式(厳守)
1 行目に「件名: <推薦状の見出し>」(20〜40 字程度の簡潔な見出し)
2 行目:空行
3 行目以降:推薦状本文(拝啓 で始まり 敬具 で終わる)

例:
件名: 山田様(プロダクトマネージャー職)推薦の件

拝啓 時下ますますご清祥のこととお慶び申し上げます。…
…(本文)…
敬具

# 体裁の細則
- 本文は「です・ます調」の丁寧語、改行は段落ごとに 1 つ
- マークダウン記法は使わない(プレーンテキスト)
- 数字は半角、敬語は過剰にしない
- 前置きや「以下が下書きです:」のような枕詞は不要(件名から直接始める)
- テンプレ(冒頭挨拶・末尾の組織連絡先)は本下書きに含めない
  → これらは別レイアウトで連結されるため、純粋に「候補者を推薦する本文」だけ生成する

${ANTI_FABRICATION_RULES}`;

/**
 * 推薦文ドラフト生成用のプロンプトを構築する
 *
 * 引数:
 *   - profile: 候補者のキャリア棚卸し結果(復号済)
 *   - jobPosting: 求人情報(必要フィールドのみ抜粋して渡す)
 *   - advisorNotes: エージェントが referrals.notes に書いた所感(任意、空可)
 *
 * 戻り値:
 *   - system: モデルの役割・ルール
 *   - prompt: モデルに渡す入力データ(JSON 形式)
 *
 * jobPosting は型を JobPosting にすると不要な列を巻き込みやすいので、
 * このプロンプト関数に必要な最小フィールドだけ受ける形にしている。
 */
export type RecommendationLetterPromptJob = {
  companyName: string;
  position: string;
  description: string | null;
  requiredSkills: string | null;
  preferredSkills: string | null;
};

export function buildRecommendationLetterDraftPrompt(params: {
  profile: CareerProfile;
  jobPosting: RecommendationLetterPromptJob;
  advisorNotes: string | null;
}): { system: string; prompt: string } {
  const { profile, jobPosting, advisorNotes } = params;

  // 候補者情報は推薦に直接関係する 4 項目だけ渡す。
  // 不要な diagnosis / facts まで渡すと、AI が「年齢」「会社規模」等の
  // 個人情報を本文に書き込もうとするリスクが上がるため。
  const candidate = {
    summary: profile.summary,
    strengths: profile.strengths,
    values: profile.values,
    wants: profile.wants,
  };

  const job = {
    company_name: jobPosting.companyName,
    position: jobPosting.position,
    description: jobPosting.description ?? "",
    required_skills: jobPosting.requiredSkills ?? "",
    preferred_skills: jobPosting.preferredSkills ?? "",
  };

  const prompt = [
    "以下の情報の範囲内だけで、求人企業に提出する推薦状の下書きを作成してください。",
    "出力形式(1 行目: 件名、空行、本文)を厳守してください。",
    "",
    "【候補者の棚卸し結果】",
    JSON.stringify(candidate, null, 2),
    "",
    "【求人情報】",
    JSON.stringify(job, null, 2),
    "",
    "【エージェントの所感(referrals.notes、任意)】",
    advisorNotes && advisorNotes.trim().length > 0 ? advisorNotes.trim() : "(特になし)",
  ].join("\n");

  return {
    system: RECOMMENDATION_LETTER_SYSTEM,
    prompt,
  };
}

/**
 * モデル出力から件名と本文を分離する。
 *
 * 仕様:
 *   - 1 行目に「件名: <見出し>」、空行、3 行目以降が本文。
 *   - モデルが指示を外す可能性に備え、件名抽出に失敗した場合は
 *     全体を本文として返し、headline は空文字にする(フェイルオープン)。
 *     UI 側で「件名を入力してください」とユーザに促せる方が安全なため。
 */
export function splitRecommendationLetterOutput(rawOutput: string): {
  headline: string;
  body: string;
} {
  const trimmed = rawOutput.trim();
  // 1 行目に「件名: ...」がある場合に抽出
  const headlineMatch = trimmed.match(/^件名[::]\s*(.+)$/m);
  if (!headlineMatch) {
    return { headline: "", body: trimmed };
  }

  const headline = headlineMatch[1].trim();
  // 件名行とそれ以降の空行を取り除いて本文を抽出
  const bodyStart = trimmed.indexOf("\n", headlineMatch.index);
  if (bodyStart < 0) {
    return { headline, body: "" };
  }
  const body = trimmed.slice(bodyStart).replace(/^\s*\n+/, "");
  return { headline, body };
}
