/**
 * 求職者 の 元書類 (履歴書 / 職務経歴書 PDF / スキャン画像) から
 * client_records の プロフィール項目 を 抽出する プロンプト + zod schema。
 *
 * 想定入力: application/pdf, image/png, image/jpeg, image/webp
 *
 * 想定出力: client_records (基本情報 + EMPRO 拡張 の 平文 + 暗号化テキスト) と
 *          同じ 形状 の JSON。 lib/clients/types.ts の updateClientRequestSchema
 *          に そのまま 流し込める キー / 値 に 寄せる。
 *
 * 実装方針:
 *   ・generateObject (tool use) は enum 系 union が 増えて 「Schema is too complex」
 *     で 弾かれる 可能性 が ある ため、 generateText → JSON.parse → zod で 検証 する
 *     (career-intake / job-extract と 同じ アプローチ)。
 *   ・「読めない 項目 は 推測しない、 未抽出 は 空文字 or 空配列」を 徹底 する。
 *     エージェント が 後で 訂正 する コスト を 下げる のが 目的。
 *   ・enum 系 は AI が 誤爆 した 場合 に 備え schema 側で 許容値 以外 → 空文字 に
 *     フォールバック。
 */

import { z } from "zod";

// ────────────────────────────────────────────
// 共通 preprocessor / field 型
// ────────────────────────────────────────────

/**
 * 文字列 を 「trim + 指定 長 で 切り詰め」 した うえ で default "" を 返す。
 *
 * 各 max は updateClientRequestSchema (lib/clients/types.ts) の PATCH 制約 と
 * 揃える。 AI が 制限 超過 の 文字列 を 返した 場合、 zod 検証 で 全体 が 落ち
 * (schema_error) → 抽出結果 が 得られない と いう UX を 避け る ため、 preprocess
 * 段階 で 静かに 切り詰め る 方針。 truncate は 末尾 で 発生 する ので、 学歴
 * 詳細 が 途中 で 切れる 可能性 は あるが、 「保存 時 に PATCH 400 で 全項目
 * 失敗」 より 遥か に 良い。
 */
function truncatedText(maxLen: number) {
  return z.preprocess((v) => {
    if (typeof v !== "string") return "";
    const trimmed = v.trim();
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  }, z.string().max(maxLen).default(""));
}

// 万円単位 の 整数 (年収)。 「350万」「¥350,000」等 の 表記揺れ を 数値化。
// AI が 文字列 を 返した 場合 も preprocess で 拾う。
const annualIncomeField = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return null;
  if (typeof val === "string") {
    const trimmed = val.replace(/[,\s万円¥]/g, "");
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  return null;
}, z.number().int().min(0).max(100000).nullable());

// 日付 (YYYY-MM-DD)。 「令和 3 年 4 月 1 日」等 は AI プロンプト側 で 変換 させる。
// 不正な 形式 は 空文字 に フォールバック。
const dateField = z.preprocess((val) => {
  if (typeof val !== "string") return "";
  const s = val.trim();
  if (!s) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}, z.string().default(""));

// enum + 空文字 の フォールバック helper。 AI が enum 外 の 値 を 返して きたら
// 空文字 に 倒す (updateClientRequestSchema の 側 で "" は null に 解釈される)。
function enumOrEmpty<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((val) => {
    if (typeof val !== "string") return "";
    return (values as readonly string[]).includes(val) ? val : "";
  }, z.string().default(""));
}

// タグ 配列 (経験業種 / 希望職種 等)。 各 要素 100 文字 以下、 最大 20 件。
// 文字列 で 来た 場合 は 「,」区切り で 分割 する 救済 は 入れない (AI に 配列 で
// 返す よう プロンプト で 明示)。
const tagArrayField = z.preprocess(
  (val) => {
    if (val === null || val === undefined) return [];
    if (!Array.isArray(val)) return [];
    return val
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0 && v.length <= 100)
      .slice(0, 20);
  },
  z.array(z.string().min(1).max(100)).max(20).default([]),
);

// ────────────────────────────────────────────
// メイン schema
// ────────────────────────────────────────────

// ─── max 長 定数 (updateClientRequestSchema と 揃える) ──────────
// 変更 する とき は lib/clients/types.ts の updateClientRequestSchema も 同時 に
// 揃え る こと。 ここ が 緩い と AI が 長文 を 返した とき PATCH 400 で 保存 全滅、
// ここ が 厳しい と AI 出力 の 末尾 が 静か に 切れる。
const MAX = {
  name: 100,
  name_kana: 100,
  nationality: 100,
  postal_code: 10,
  prefecture: 20,
  city: 100,
  street: 200,
  building: 200,
  phone: 20,
  email: 254, // RFC 5321 の 実務 上限 (updateClientRequestSchema は format 検証 のみ)
  // 暗号化 テキスト
  education_detail: 2000,
  skills: 5000,
  job_change_reason: 2000,
  desired_conditions: 5000,
} as const;

export const clientExtractionSchema = z.object({
  // ── 基本属性 (平文)
  name: truncatedText(MAX.name),
  name_kana: truncatedText(MAX.name_kana),
  birth_date: dateField,
  gender: enumOrEmpty(["male", "female", "other", "prefer_not_to_say"] as const),
  nationality: truncatedText(MAX.nationality),
  marital_status: enumOrEmpty(["single", "married", "prefer_not_to_say"] as const),

  // ── 連絡先 (平文)
  phone: truncatedText(MAX.phone),
  phone2: truncatedText(MAX.phone),
  email: truncatedText(MAX.email),
  email2: truncatedText(MAX.email),

  // ── 住所 (平文)
  postal_code: truncatedText(MAX.postal_code),
  prefecture: truncatedText(MAX.prefecture),
  city: truncatedText(MAX.city),
  street: truncatedText(MAX.street),
  building: truncatedText(MAX.building),
  // 現住所のフリガナ(書類にあれば抽出、無ければ漢字住所からカタカナ生成)。
  // CLIENT_EXTRACTION_FIELD_KEYS には含めない(プロフィール反映モーダルの対象外)。
  address_kana: truncatedText(200),

  // ── 現職情報 (平文 enum / 数値 / 配列)
  current_employment_type: enumOrEmpty([
    "full_time",
    "contract",
    "temporary",
    "part_time",
    "business_outsource",
    "self_employed",
    "unemployed",
    "student",
    "other",
  ] as const),
  current_annual_income: annualIncomeField,
  final_education: enumOrEmpty([
    "high_school",
    "vocational",
    "junior_college",
    "university",
    "graduate",
    "doctorate",
    "other",
  ] as const),
  experience_industries: tagArrayField,
  experience_occupations: tagArrayField,

  // ── 希望条件 (平文)
  desired_industries: tagArrayField,
  desired_occupations: tagArrayField,
  desired_locations: tagArrayField,
  desired_annual_income: annualIncomeField,
  job_change_timing: enumOrEmpty([
    "immediate",
    "within_3months",
    "within_6months",
    "within_1year",
    "undecided",
  ] as const),

  // ── 暗号化 テキスト (自由記述、 更新時 に encryptField)
  education_detail: truncatedText(MAX.education_detail),
  skills: truncatedText(MAX.skills),
  job_change_reason: truncatedText(MAX.job_change_reason),
  desired_conditions: truncatedText(MAX.desired_conditions),
  // 自己PR / アピールポイント(書類の該当欄)。FIELD_KEYS 非対象。
  self_pr: truncatedText(2000),

  // ── 抽出メタ (UI で「読み取り精度」 表示 に 使う)
  extraction_notes: z.string().max(5000).default(""),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

export type ClientExtractionResult = z.infer<typeof clientExtractionSchema>;

/**
 * 抽出対象 の フィールド キー 一覧 (extraction_notes / confidence を 除く)。
 *
 * プレビュー モーダル の 「行の 展開 順」 や diff 判定 で 参照する 単一 の
 * source of truth。 スキーマ を 増やす とき は こちら も 追加 する。
 */
export const CLIENT_EXTRACTION_FIELD_KEYS = [
  "name",
  "name_kana",
  "birth_date",
  "gender",
  "nationality",
  "marital_status",
  "phone",
  "phone2",
  "email",
  "email2",
  "postal_code",
  "prefecture",
  "city",
  "street",
  "building",
  "current_employment_type",
  "current_annual_income",
  "final_education",
  "experience_industries",
  "experience_occupations",
  "desired_industries",
  "desired_occupations",
  "desired_locations",
  "desired_annual_income",
  "job_change_timing",
  "education_detail",
  "skills",
  "job_change_reason",
  "desired_conditions",
] as const;

export type ClientExtractionFieldKey = (typeof CLIENT_EXTRACTION_FIELD_KEYS)[number];

/**
 * snake_case (client_records カラム / API PATCH のキー) → camelCase
 * (ClientRecordWithDecrypted の TS プロパティ名) の 対応 表。
 *
 * 抽出 API の レスポンス で `current` を 組む 際 に、 CLIENT_EXTRACTION_FIELD_KEYS を
 * loop しつつ この 対応 で ClientRecordWithDecrypted の 値 を 参照 する。 手書き
 * マッピング を 避け る こと で、 スキーマ に フィールド を 追加 する とき に
 * このファイル 1 箇所 だけ の 修正 で 済む。
 *
 * "encrypted_*" の 復号 済 プロパティ (educationDetail 等) も この 対応 に 含む
 * (ClientRecordWithDecrypted は 復号 版 の カメル 名 で 公開 して いる)。
 */
export const CLIENT_EXTRACTION_KEY_TO_CAMEL: Record<ClientExtractionFieldKey, string> = {
  name: "name",
  name_kana: "nameKana",
  birth_date: "birthDate",
  gender: "gender",
  nationality: "nationality",
  marital_status: "maritalStatus",
  phone: "phone",
  phone2: "phone2",
  email: "email",
  email2: "email2",
  postal_code: "postalCode",
  prefecture: "prefecture",
  city: "city",
  street: "street",
  building: "building",
  current_employment_type: "currentEmploymentType",
  current_annual_income: "currentAnnualIncome",
  final_education: "finalEducation",
  experience_industries: "experienceIndustries",
  experience_occupations: "experienceOccupations",
  desired_industries: "desiredIndustries",
  desired_occupations: "desiredOccupations",
  desired_locations: "desiredLocations",
  desired_annual_income: "desiredAnnualIncome",
  job_change_timing: "jobChangeTiming",
  education_detail: "educationDetail",
  skills: "skills",
  job_change_reason: "jobChangeReason",
  desired_conditions: "desiredConditions",
};

/**
 * 各 フィールド の 日本語 ラベル (プレビュー モーダル の 行 見出し 用)。
 */
export const CLIENT_EXTRACTION_FIELD_LABELS: Record<ClientExtractionFieldKey, string> = {
  name: "氏名",
  name_kana: "フリガナ",
  birth_date: "生年月日",
  gender: "性別",
  nationality: "国籍",
  marital_status: "配偶者",
  phone: "電話番号",
  phone2: "電話番号(副)",
  email: "メールアドレス",
  email2: "メールアドレス(副)",
  postal_code: "郵便番号",
  prefecture: "都道府県",
  city: "市区町村",
  street: "番地",
  building: "建物名・部屋番号",
  current_employment_type: "現職の雇用形態",
  current_annual_income: "現在の年収(万円)",
  final_education: "最終学歴",
  experience_industries: "経験業種",
  experience_occupations: "経験職種",
  desired_industries: "希望業種",
  desired_occupations: "希望職種",
  desired_locations: "希望勤務地",
  desired_annual_income: "希望年収(万円)",
  job_change_timing: "転職希望時期",
  education_detail: "学歴詳細",
  skills: "資格・スキル",
  job_change_reason: "転職理由",
  desired_conditions: "希望条件詳細",
};

// ────────────────────────────────────────────
// プロンプト本体
// ────────────────────────────────────────────

export const CLIENT_EXTRACTION_SYSTEM_PROMPT = `あなたは日本の人材紹介エージェントのベテラン事務担当です。求職者から受け取った既存の履歴書・職務経歴書・自己申告シート等(PDF / スキャン画像)を読み取り、CRM(client_records)の項目に流し込むための構造化データを返すのが仕事です。

# 絶対に守るルール

1. **書かれていない情報は推測しない**。
   ・読み取れない / 書かれていない項目は **空文字 ""**、配列項目は **空配列 []**、数値項目は **null** を返す。
   ・「たぶんこうだろう」で埋めない。エージェントが後で訂正するコストが大きい。
   ・履歴書に「志望動機」欄しかなくても「転職理由」を推測して埋めたりしない。関連する自由記述は job_change_reason に転記して良いが、「志望動機として書かれている」旨を extraction_notes に必ず明記する。

2. **氏名・フリガナ**。
   ・name には姓名を空白1つで区切って返す(例: "山田 太郎")。全角スペース1つも OK。
   ・name_kana はカタカナで統一(ひらがな表記なら AI 側でカタカナに変換して良い)。姓名の間は空白1つ。

3. **日付は YYYY-MM-DD に統一**。
   ・「昭和60年4月1日」「1985/04/01」「1985年4月1日」→ "1985-04-01"。
   ・和暦・元号は西暦に換算。判断が付かない場合は空文字を返し extraction_notes に「生年月日の年が読み取れず」等記載。

4. **年収は万円単位の整数**。
   ・「年収450万円」→ 450、「¥4,500,000」→ 450。
   ・「月給28万+賞与年2回」のように月給しか書かれていない場合は暫定で ×12 = 336 を採用し、extraction_notes に「月給28万×12=336換算、賞与月数不明」と明記。
   ・「応相談」「経験に応じ」など数値が無い場合は null。

5. **enum 系は指定の値だけを返す**(それ以外は空文字 "")。
   ・gender: "male" | "female" | "other" | "prefer_not_to_say" | ""
   ・marital_status: "single" | "married" | "prefer_not_to_say" | ""
   ・current_employment_type: "full_time" | "contract" | "temporary" | "part_time" | "business_outsource" | "self_employed" | "unemployed" | "student" | "other" | ""
     - 「正社員 / 無期雇用 / 正規」→ "full_time"
     - 「契約社員 / 有期契約」→ "contract"
     - 「派遣」→ "temporary"
     - 「アルバイト / パート」→ "part_time"
     - 「業務委託 / フリーランス受託」→ "business_outsource"
     - 「自営業」→ "self_employed"
     - 「離職中 / 無職 / 求職中」→ "unemployed"
     - 「学生」→ "student"
   ・final_education: "high_school" | "vocational" | "junior_college" | "university" | "graduate" | "doctorate" | "other" | ""
     - 「〇〇大学 卒業」→ "university"
     - 「〇〇大学院 修士課程 修了」→ "graduate"
     - 「〇〇大学院 博士課程 修了」→ "doctorate"
     - 「〇〇専門学校 卒業」→ "vocational"
     - 「〇〇短期大学 卒業」→ "junior_college"
     - 「〇〇高等学校 卒業」→ "high_school"
   ・job_change_timing: "immediate" | "within_3months" | "within_6months" | "within_1year" | "undecided" | ""
     - 「すぐにでも / 転職活動中」→ "immediate"
     - 「3ヶ月以内」→ "within_3months"
     - 「半年以内 / 6ヶ月以内」→ "within_6months"
     - 「1年以内 / 来年 春頃」→ "within_1year"
     - 「未定 / 良い縁があれば」→ "undecided"

6. **住所は分割して返す**。
   ・postal_code: "123-4567" 形式(ハイフン付き)。ハイフン無しで書かれていれば付ける。
   ・prefecture: "東京都" / "神奈川県" 等(末尾の都道府県まで含む)。
   ・city: "港区" / "横浜市西区" 等(市区町村)。
   ・street: 番地部分("六本木1-2-3" 等)。
   ・building: マンション名・部屋番号("〇〇マンション301号室")。
   ・「大阪府大阪市中央区本町1-2-3」なら prefecture="大阪府" / city="大阪市中央区" / street="本町1-2-3" / building="" とする。
   ・address_kana: 現住所のフリガナ(全角カタカナ)。書類に「現住所ふりがな」欄があればそれを転記。無ければ prefecture+city+street の漢字住所から読みを推定して全角カタカナで入れる(町名まででよく、番地・建物名のカナは不要)。判読不能な固有名詞は無理に読まず、その旨を extraction_notes に記す。

7. **配列項目は文字列配列で返す**(空配列 = 未抽出)。
   ・experience_industries: 経験した業種のタグ(例: ["IT・通信", "SaaS"])。「経営コンサルタント業」等 は職種寄りなので experience_occupations に。
   ・experience_occupations: 経験した職種のタグ(例: ["営業", "カスタマーサクセス"])。
   ・desired_industries / desired_occupations / desired_locations: 希望条件の該当欄。「関東エリア」「首都圏」等はそのまま入れて良い。
   ・各配列は 20 件まで。重複は排除。

8. **暗号化テキスト系(長文自由記述)**。
   ・education_detail: 学歴の詳細を「〜年〜月 学校名 学部学科 卒業/入学」の行を並べて。5〜20 行程度、**2000 文字以内**。final_education の enum で足りない粒度をここに残す。上限超過は末尾が切り捨てられるので、要点だけに絞ること。
   ・skills: 資格・スキル(例: "普通自動車第一種免許 / TOEIC 850 / AWS SAA / VLOOKUP・SUMIF / Python(業務3年)")を 1 か所に集約。技能検定 / 語学 / 実務経験 のスキルもここに。**5000 文字以内**。
   ・job_change_reason: 「なぜ辞めた / なぜ転職したい」を 3〜10 行、**2000 文字以内**。原文が「志望動機」欄しか無くても、内容が転職理由に近ければ入れて良い(その場合 extraction_notes に「志望動機欄を転記」と明記)。
   ・desired_conditions: 「給与 / 勤務地 / 業界 / 職種 / 働き方 / 福利厚生 / チーム / その他」の希望条件詳細をまとめて 5〜20 行、**5000 文字以内**。desired_industries 等の構造化タグでは表現できない粒度をここに残す。
   ・self_pr: 自己PR / アピールポイント / 自己紹介 欄の内容を転記(**2000 文字以内**)。「強み・実績・人柄」の自己PRに限定し、志望動機は job_change_reason 側に入れる。該当欄が無ければ空文字。

9. **extraction_notes に書くこと**(担当者の確認用メモ)。
   ・推測・換算・統一表記を当てた項目を 1 行ずつ列挙。例:
     - "月給28万×12=年収336換算(賞与月数不明で加算なし)"
     - "生年月日の年が『昭和』表記で 60→1985 に換算"
     - "履歴書に『志望動機』欄しかなかったため job_change_reason に転記した"
     - "住所の建物名部分が判読できず building は空文字"
   ・読み取れなかった主要項目(生年月日 / 住所 / 電話 / 年収 等)で「あれば価値があるのに取れなかった」ものは「電話番号が読み取れず」等記載。
   ・特に無ければ空文字 ""。

10. **confidence の基準**。
    ・high: 氏名 + 生年月日 + 住所(都道府県まで)+ 電話 or メール + 学歴 が 明確に読めた。
    ・medium: 氏名は読めたが、住所 or 連絡先 or 学歴で推測 / 換算 / 判読困難が発生。
    ・low: 氏名が読めない、または ドキュメント全体が求人書類として読みにくい / 別書類の可能性。

# 出力フォーマット

下記の フィールドを 持つ JSON オブジェクト のみ を 返してください。前置き / 解説 / コードフェンス は 不要です。

\`\`\`
{
  "name": "<string>",
  "name_kana": "<string>",
  "birth_date": "<YYYY-MM-DD or 空文字>",
  "gender": "male"|"female"|"other"|"prefer_not_to_say"|"",
  "nationality": "<string>",
  "marital_status": "single"|"married"|"prefer_not_to_say"|"",
  "phone": "<string>",
  "phone2": "<string>",
  "email": "<string>",
  "email2": "<string>",
  "postal_code": "<string>",
  "prefecture": "<string>",
  "city": "<string>",
  "street": "<string>",
  "building": "<string>",
  "address_kana": "<string>",
  "current_employment_type": "<enum or 空文字>",
  "current_annual_income": <number|null>,
  "final_education": "<enum or 空文字>",
  "experience_industries": ["<string>", ...],
  "experience_occupations": ["<string>", ...],
  "desired_industries": ["<string>", ...],
  "desired_occupations": ["<string>", ...],
  "desired_locations": ["<string>", ...],
  "desired_annual_income": <number|null>,
  "job_change_timing": "<enum or 空文字>",
  "education_detail": "<string>",
  "skills": "<string>",
  "job_change_reason": "<string>",
  "desired_conditions": "<string>",
  "self_pr": "<string>",
  "extraction_notes": "<string>",
  "confidence": "high"|"medium"|"low"
}
\`\`\`

文字列項目は「未抽出」の場合 空文字 "" を、配列は空配列 [] を、数値は null を返してください。`;

export const CLIENT_EXTRACTION_USER_PROMPT = `添付の書類(履歴書・職務経歴書・自己申告シート等)を読み取り、求職者プロフィール項目を構造化して返してください。

・書かれていない項目は推測せず 空文字 "" / 空配列 [] / null を返してください。
・enum 系(gender / current_employment_type / final_education / job_change_timing / marital_status)は指定の値だけを使ってください。合致しない場合は空文字 ""。
・年収は万円単位の整数(月給 表記は年収換算)。日付は YYYY-MM-DD。
・住所は postal_code / prefecture / city / street / building に分割してください。
・志望動機を job_change_reason に転記した等、原文と扱いが異なる箇所は extraction_notes に必ず明記してください。`;
