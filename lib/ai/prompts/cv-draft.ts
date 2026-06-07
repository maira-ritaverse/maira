import { z } from "zod";
import type { CareerProfile } from "@/lib/career/profile-schema";
import { employmentTypeLabels, skillSchema, type WorkExperience } from "@/lib/cvs/types";

/**
 * 職務経歴書「自由記述欄」のAI下書き生成プロンプト
 *
 * Phase 4-a 時点で対象:
 * - summary: 職務要約(150〜250字)
 * - self_pr: 自己PR(300〜500字)
 *
 * Phase 4-b で追加:
 * - work_experience: 各職歴の「業務内容」「実績・成果」を { job_description, achievements } で返す
 *
 * Phase 4-c で追加(このコミット):
 * - skills: 棚卸しの強みからスキル候補を抽出して返す(ユーザーが採択する前提)
 *
 * 履歴書(resume-draft.ts)とルール本文を共通化しなかった理由:
 * - 履歴書は「貴社」「です・ます調」「履歴書らしい誠実な文体」が前提
 * - 職務経歴書は箇条書き可、汎用書類なので「貴社」は使わない、トーンが異なる
 * - 共通化すると文体の例外ルールが増えて見通しが悪くなる
 * - 捏造防止という核は同じだが、文体ガイドが大きく違うので別文面で書く
 *   (重複が痛くなれば後で _shared/ に切り出す)
 */

export type CvDraftField = "summary" | "self_pr" | "work_experience" | "skills";

/**
 * skills 生成の出力スキーマ(generateObject 用)
 *
 * generateObject は object スキーマを要求するので、配列は candidates キーに包む。
 * 配列要素は CV フォーム側 skillSchema を流用(category/name/level/description の 1 行スキル)。
 * 上限 20 件:AI が冗長に並べないように zod レベルでガード(プロンプトでは「最大 8 件」を目安に指示)。
 */
export const skillCandidatesSchema = z.object({
  candidates: z.array(skillSchema).max(20),
});
export type SkillCandidates = z.infer<typeof skillCandidatesSchema>;

/**
 * work_experience 生成の出力スキーマ(generateObject 用)
 *
 * フォーム側 workExperienceSchema(lib/cvs/types.ts)と最大長を揃える。
 * - job_description は空文字 NG(下書きが空っぽだと AI を呼んだ意味が無いため)
 * - achievements は空文字 OK(関連する evidence が無い場合、無理に
 *   実績を捏造させないため。プロンプトでも「無ければ短く・定性的に・最悪空でも可」)
 */
export const workExperienceDraftSchema = z.object({
  job_description: z.string().min(1, "業務内容は空にできません").max(2000),
  achievements: z.string().max(2000),
});
export type WorkExperienceDraft = z.infer<typeof workExperienceDraftSchema>;

/**
 * 捏造防止ルール(CV用)
 *
 * career_profile に書かれていない情報を AI が作ることを防ぐ。
 * 職務経歴書は応募先に提出する事実書類なので、虚偽記載のリスクを最小化する。
 */
const ANTI_FABRICATION_RULES = `
# 絶対に守るルール(虚偽記載防止)

1. **career_profile に書かれていない情報は、絶対に創作しない**:
   - 資格名(例:TOEIC ○○点、簿記○級 など)を勝手に書かない
   - 学校名・学部・学位を勝手に書かない
   - 具体的な会社名・プロジェクト名・サービス名を勝手に書かない
   - 数値(年収、人数、売上、改善率 など)を捏造しない
   - 受賞歴・表彰歴を創作しない
   - 在籍年数を勝手に書かない(user_facts.years_of_experience に無ければ書かない)

2. **棚卸し結果にある情報のみを、自然な日本語に整える**:
   - summary, strengths, values, user_facts を「本人の言葉」として再構成する
   - 強みの evidence は具体例として活かしてよいが、固有名詞は伏せる
     (例:「○○社で」→「前職で」「これまでの業務で」)
   - プロジェクト名は「新規プロダクトの開発」「業務改善の推進」など汎用化する

3. **自画自賛・誇張は避ける**:
   - 「素晴らしい」「卓越した」「圧倒的な」等の自己評価は使わない
   - 事実 + 取り組み + 学びの順で淡々と書く

4. **応募書類であることを意識**:
   - 職務経歴書らしい簡潔で構造的な文体
   - 「貴社」「御社」等の応募先呼称は使わない(汎用書類のため)
   - 一人称「私」は多用せず、主語は省略で自然に書く

5. **情報が足りない場合**:
   - 創作で穴埋めしない
   - 棚卸し結果にある範囲で書ける分だけ書く
   - データ不足を理由に「下書きを作れません」とは言わない(できる範囲で出す)`;

const SUMMARY_SYSTEM = `あなたは職務経歴書の「職務要約」欄の下書きを作成するアシスタントです。
ユーザーがキャリア棚卸しで語った内容を、職務経歴書冒頭の「職務要約」に整えます。

# このタスクで生成するもの
職務経歴書の冒頭に置く「職務要約」(キャリアの全体像を採用担当者に短時間で伝える文章)。

# 文字数
150〜250字程度。1段落。

# 構成の目安(見出しは付けない、本文のみ)
- 現職または直近の役割(user_facts.current_role / industry がある場合)
- 経験年数(user_facts.years_of_experience がある場合のみ。無ければ書かない)
- 主な強み・専門領域(strengths から上位 1〜2 点)
- 全体としてどんな職務に取り組んできたか(summary を参考に)

# 注意
- 応募先を限定しない汎用的な文章にする(志望動機は別書類)
- 「○○年間〜してきました」のような断定は、データがある時だけ書く
- 箇条書きは使わず、1段落の地の文で書く

${ANTI_FABRICATION_RULES}

# 出力形式
- 文章のみ(前置きや「以下が下書きです:」のような枕詞は不要)
- マークダウン記法は使わない(プレーンテキスト)`;

const SELF_PR_SYSTEM = `あなたは職務経歴書の「自己PR」欄の下書きを作成するアシスタントです。
ユーザーがキャリア棚卸しで語った強み・価値観を、職務経歴書末尾の「自己PR」に整えます。

# このタスクで生成するもの
職務経歴書の末尾に置く「自己PR」(候補者の人物像・強みを伝える文章)。

# 文字数
300〜500字程度。1〜2段落。

# 構成の目安(見出しは付けない、本文のみ)
- 強みを 2〜3 点に絞って柱とする(strengths から最も訴求力の高いもの)
- 各強みについて、棚卸しで語った evidence を「具体例」として 1〜2 文で示す
  (固有名詞は伏せる:「前職で」「これまでの業務で」)
- 価値観(values)を1点、働き方の方針として軽く触れる
- 締めは「今後も〜していきたい」のような前向きな展望(汎用的に、特定の応募先は出さない)

# 注意
- 強みを箇条書きにはしない(地の文で書く)
- 「私の強みは」を連発しない(主語は省略するか、文末・接続で工夫する)
- 「素晴らしい成果を上げました」のような自画自賛は書かない

${ANTI_FABRICATION_RULES}

# 出力形式
- 文章のみ(前置きや「以下が下書きです:」のような枕詞は不要)
- マークダウン記法は使わない(プレーンテキスト)`;

const SKILLS_SYSTEM = `あなたは職務経歴書の「スキル」セクションに入れる候補リストを作成するアシスタントです。
ユーザーがキャリア棚卸しで語った強み(strengths)から、スキルとして提示できる
候補を抽出します。ユーザーがチェックで採択する前提なので、AI は
「本人が確実に持っている」と言える範囲だけを候補に挙げます。

# このタスクで生成するもの
スキル候補の配列(最大 8 件、根拠が強いものを優先)。各候補は職務経歴書フォームの
1 行スキル(category, name, level, description)。

# カテゴリの割り当てルール
strengths.category と、label/evidence の中身に基づいて決める:
- strengths.category が hard_skill:
  - プログラミング言語(JavaScript, Python など)→ language
  - フレームワーク・ライブラリ(React, Rails など)→ framework
  - ツール・環境(Figma, Docker, Notion など)→ tool
  - 業界・領域の専門知識(SaaS 業務理解、SEO 知識 など)→ domain
  - 上記に当てはまらない技術スキル → other
- strengths.category が soft_skill → soft_skill
- strengths.category が experience → domain
- 判別が難しい場合 → other

# 🔴 候補抽出のルール(捏造防止、最重要)
1. strengths.label / evidence に **直接出てくるスキル名のみ** 候補にする
   → 具体的なスキル名を含まない強み(例:「ユーザー視点の機能設計」)も、
     ソフトスキルとして「ユーザー視点の機能設計」と name に取ってよい
   → ただし、そこから「Figma も使えるはず」のような推測は禁止
2. 「PM をやっていたから○○ も使えるだろう」のような推測で関連スキルを足さない
3. 「TypeScript 経験あり」とあったら「JavaScript」「Node.js」も足す、のような
   暗黙の関連スキル推測を一切しない(本人が言及していないなら出さない)
4. evidence にスキル名が複数含まれている場合は、それぞれ別の候補として出してよい
5. 同じスキル名は 1 度だけ(重複させない)
6. 抽出できるスキルが少なくても無理に水増ししない(0 件で構わない)
7. name は固有名詞を尊重しつつ簡潔に(例:「TypeScript」「Figma」「ファシリテーション」)
8. level の判定:
   - evidence に「リード」「設計」「主担当」「責任者」のような語があれば advanced
   - 「経験あり」「使った」「担当」程度なら intermediate
   - 「学習中」「触り始め」なら basic
   - 判断材料が無ければ null(無理に埋めない)
9. description は基本 null。evidence から汎用化した短い補足を付けたい時のみ。
   固有名詞・会社名・サービス名は description にも入れない。

${ANTI_FABRICATION_RULES}

# 出力形式
- JSON: { "candidates": Skill[] }
- 各 Skill のフィールドは category, name, level, description のみ
- name は 100 字以内、description は 500 字以内(短いほどよい)
- 候補が無い場合は { "candidates": [] } を返す(無理に作らない)`;

const WORK_EXPERIENCE_SYSTEM = `あなたは職務経歴書の各職歴(行)の「業務内容」と「実績・成果」の下書きを作成するアシスタントです。
ユーザーが入力した「役職・業界・雇用形態」を事実として尊重し、
キャリア棚卸しと照らし合わせて、その役割で行った業務と成果を文章化します。

# このタスクで生成するもの
職務経歴書の 1 件の職歴(行)に入る:
- job_description: 担当した業務の説明
- achievements: 数値で示せる成果があれば数値で、なければ定性的に、無ければ短く

# 文字数の目安
- job_description: 100〜250字程度(箇条書きまたは短い段落)
- achievements: 50〜200字程度(関連する evidence が無ければさらに短く、最悪空に近くてもよい)

# 入力データの扱い(重要)
- 渡された facts のうち「会社名・期間・雇用形態」は出力本文には書かない
  (フォームの別欄に既に出ているため、本文で重複させない)
- 役職(position)と業界(industry)は本文の文脈として使ってよい
  例:「PM として」「SaaS 業界で」
- 会社名が必要な場面では「同社で」「前職で」「在籍中の会社で」と伏せる
- キャリア棚卸し(strengths / summary)から、この役職・業界に
  「関連しそうなもの」を AI が選んで evidence を抽象化して活かす

# 🔴 強みが薄い/関連が無い場合の処理(最重要)
- strengths の中に、この役職・業界と「明らかに関連するもの」が無い場合:
  → その役職の「一般的な業務範囲」レベルに留める
    例:「PM として、要件定義、開発進行管理、関係者調整を担当した」
  → 数値・具体的成果を絶対に作らない
  → achievements は「○○の領域で経験を積んだ」のような短い定性記述、
    または空に近い記述に留める(ユーザーが後で埋める前提)
- 関連する evidence が見当たらないことを理由に「下書きを作れません」と
  断らない。役職・業界に基づく汎用記述は出してよい。

# 構成の目安(見出しは付けない、本文のみ)
## job_description
- 役職・業界をふまえた「担当した業務」の説明
- 関連する strengths.evidence があれば、それを汎用化して織り込む
  (固有名詞・サービス名・社内用語は出さない → 「新規プロダクト開発」「業務改善」レベル)
- 「・」で始める箇条書き(3〜5行)が読みやすい

## achievements
- 関連する evidence に数値があれば、それを引用してよい(例:○○% 改善)
- evidence に成果記述が無ければ、定性的に短く書く
  (「定例運用の改善に取り組み、チームへの定着につなげた」など)
- 🔴 evidence に無い数値(売上○%、○名規模、○億、改善率)を絶対に作らない
- 🔴 evidence に無いプロジェクト名・サービス名・受賞歴を絶対に作らない

${ANTI_FABRICATION_RULES}

# 出力形式
- JSON。キーは job_description, achievements。値はそれぞれプレーンテキスト
- 本文にマークダウン記法(**, ##, [] 等)は使わない
- 文の中に「ユーザー入力の会社名」を絶対に書かない`;

/**
 * 職務経歴書下書き生成用のプロンプトを構築する
 *
 * resume-draft.ts と同じ「system に役割・prompt にデータ」分担。
 * profile から該当フィールドに関係する部分だけ抜き出して渡すことで、
 * AI が「関係ない情報を盛り込んで欄に合わない文章になる」のを防ぐ。
 *
 * work_experience の場合は、当該職歴の WorkExperience(事実)も渡す。
 * 会社名・期間は意図的に prompt に含めない(本文で出してはいけないため、
 * そもそも AI に知らせない方が漏れ防止になる)。
 */
export function buildCvDraftPrompt(
  params:
    | { field: "summary"; profile: CareerProfile }
    | { field: "self_pr"; profile: CareerProfile }
    | { field: "work_experience"; profile: CareerProfile; workExperience: WorkExperience }
    | { field: "skills"; profile: CareerProfile },
): { system: string; prompt: string } {
  if (params.field === "skills") {
    // 候補抽出は strengths のみが材料。user_facts などは渡さない
    // (役職から「○○ も使えるはず」と推測されないようにする)。
    const relevant = {
      strengths: params.profile.strengths,
    };

    return {
      system: SKILLS_SYSTEM,
      prompt: [
        "以下は、ユーザーがキャリア棚卸しで語った『強み』の一覧です。",
        "この中から、職務経歴書のスキル欄に出せる候補を抽出してください。",
        "強みに直接出てくるスキル名のみを候補にし、推測で関連スキルを足さないでください。",
        "妥当な候補が少なければ件数を絞って構いません(0 件でも可)。",
        "",
        "【棚卸し結果(強みのみ)】",
        JSON.stringify(relevant, null, 2),
      ].join("\n"),
    };
  }

  if (params.field === "work_experience") {
    const { workExperience, profile } = params;

    // AI に渡す事実:会社名・期間は意図的に含めない。
    // 本文に出してはいけない情報なので、そもそも知らせない方が漏れ防止になる。
    // 役職・業界・雇用形態は文脈に使うため渡す。
    const facts = {
      position: workExperience.position,
      industry: workExperience.industry,
      employment_type: workExperience.employment_type
        ? employmentTypeLabels[workExperience.employment_type]
        : null,
      is_current: workExperience.period_end === null,
    };

    // 棚卸し側は strengths を丸ごと渡し、AI に関連する 1〜2 件を選ばせる。
    // 在籍期間との overlap は AI には判定不能なので、ラベル・evidence から
    // 役職・業界との関連性を推測してもらう前提(無ければ汎用記述に留める)。
    const careerContext = {
      summary: profile.summary,
      strengths: profile.strengths,
      values: profile.values,
    };

    return {
      system: WORK_EXPERIENCE_SYSTEM,
      prompt: [
        "以下は、(A) ユーザーが入力した職歴の「事実」(本文では使い方が制限される情報) と、",
        "(B) キャリア棚卸しの結果(関連する強みをここから選んで使う) です。",
        "(A) の役職・業界は本文の文脈に使ってよいですが、会社名・期間は出力に含めません",
        "(そもそも (A) には会社名・期間は載せていません)。",
        "(B) に この役職・業界と関連が薄い場合は、無理に固有の成果や数値を作らず、",
        "役職の一般的な業務範囲に留めてください。",
        "",
        "【A. この職歴の事実】",
        JSON.stringify(facts, null, 2),
        "",
        "【B. キャリア棚卸し結果】",
        JSON.stringify(careerContext, null, 2),
      ].join("\n"),
    };
  }

  const { field, profile } = params;

  if (field === "summary") {
    // 職務要約に関係する部分だけ抜粋。
    // strengths は上位 2 件のラベルのみ(要約欄は強みを並べる場所ではないため evidence は不要)。
    const relevant = {
      user_facts: profile.user_facts,
      summary: profile.summary,
      top_strengths: profile.strengths.slice(0, 2).map((s) => s.label),
    };

    return {
      system: SUMMARY_SYSTEM,
      prompt: [
        "以下は、ユーザーがキャリア棚卸しで語った内容の抜粋です。",
        "この情報の範囲だけを使って、職務経歴書の「職務要約」欄の下書きを作成してください。",
        "",
        "【棚卸し結果(職務要約に関連する部分)】",
        JSON.stringify(relevant, null, 2),
      ].join("\n"),
    };
  }

  // self_pr:強みの evidence を活かしたいので strengths は丸ごと、
  // values と summary も渡す(wants/concerns は自己PRには不要)。
  const relevant = {
    summary: profile.summary,
    strengths: profile.strengths,
    values: profile.values,
  };

  return {
    system: SELF_PR_SYSTEM,
    prompt: [
      "以下は、ユーザーがキャリア棚卸しで語った内容の抜粋です。",
      "この情報の範囲だけを使って、職務経歴書の「自己PR」欄の下書きを作成してください。",
      "",
      "【棚卸し結果(自己PRに関連する部分)】",
      JSON.stringify(relevant, null, 2),
    ].join("\n"),
  };
}
