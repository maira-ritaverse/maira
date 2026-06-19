/**
 * 求人票 PDF / 画像 から 構造化求人情報を 抽出する プロンプト + zod schema
 *
 * 想定入力:
 *   ・PDF(企業 / 求人媒体が 配布する 求人票)
 *   ・画像(求人媒体の スクリーンショット、紙の 求人票を 撮影した 画像)
 *
 * 想定出力:
 *   ・lib/jobs/types.ts の createJobRequestSchema と 同じ形状の JSON
 *   ・必須 2 項目(company_name / position)が 確実に 埋まる ように プロンプトで 強調
 *   ・年収は 万円単位の 整数(45万 → 月収だと 判断したら 12 倍する 等の 換算は AI 側で 行う)
 *
 * 「読めないところは 推測しない」が 基本方針:推測で 埋めると エージェントが
 * 後で 訂正する コストが 高い、空欄なら 自分で 補完 すれば 良い。
 */

import { z } from "zod";

/**
 * AI 出力用 zod schema(generateObject に そのまま 渡す)
 *
 * createJobRequestSchema との 違い:
 *   ・status は AI が 判断する 領域 ではないので 出力させない(常に "open" にする)
 *   ・各フィールドは `.nullable()` に している:AI が 「読めなかった」場合に 明示的に
 *     null を 返せる ようにし、空文字との 違いを 表現できる ように する
 *   ・salary_min / salary_max は 万円単位の 整数 だが、AI 都合で 文字列を 返して
 *     しまった ケースに 備え preprocess で 数値化する
 *   ・必須項目(company_name / position)が 読み取れない 場合は 「不明」と 返す
 *     ことを 許容(POST 側で 空文字 / 「不明」を null 相当に 正規化)
 */
// 上限は createJobRequestSchema と 揃えること(lib/jobs/types.ts)。
// AI 抽出は ★ 区切りで 集約する 設計なので、description は 12000 字 まで 許容。
// 法定明示事項(holidays / application_qualifications)も 集約 結果が 入る ので
// 4000 字 まで 緩める(従来 2000 だった ため、AI 集約 が 不足側に 押し込まれ
// schema 違反 が 起きていた)。
const nullableShortText = z.string().max(300).nullable();
const nullableLongText = z.string().max(12000).nullable();
const nullableLabourField = z.string().max(4000).nullable();

const nullableSalary = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return null;
  if (typeof val === "string") {
    const trimmed = val.replace(/[,\s万円]/g, "");
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  return null;
}, z.number().int().min(0).max(100000).nullable());

export const jobExtractionSchema = z.object({
  company_name: nullableShortText,
  position: nullableShortText,
  employment_type: nullableShortText,
  location: nullableShortText,
  salary_min: nullableSalary,
  salary_max: nullableSalary,
  description: nullableLongText,
  required_skills: nullableLabourField,
  preferred_skills: nullableLabourField,
  // 法定明示事項 8 列(2024 年改正労基法対応)
  work_change_scope: nullableLabourField,
  location_change_scope: nullableLabourField,
  smoking_prevention_measure: nullableLabourField,
  probation_period: nullableLabourField,
  work_hours: nullableLabourField,
  break_time: nullableLabourField,
  holidays: nullableLabourField,
  application_qualifications: nullableLabourField,
  // 抽出メタ:何を 根拠に 抜いたか / 自信度。UI で「読み取り精度」表示用。
  extraction_notes: z.string().max(1000).nullable(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

export type JobExtractionResult = z.infer<typeof jobExtractionSchema>;

/**
 * 「読めない」「自信が無い」を null で 表現する 旨を 強調する 必要が ある。
 * AI は つい 体裁を 整える ために 自然な 推測値を 入れがちで、
 * それが 「実態と 違う 求人票が 登録される」事故に つながる。
 *
 * トーンは 「事務処理員に 指示する」感じで 端的に。冗長な 前置きは 入れない。
 *
 * 出力カラムは 18 個に 固定(jobExtractionSchema に 対応)。媒体側で 拾える 情報の
 * うち、対応カラムが 無い ものは description / extraction_notes に 適切に 集約する。
 * 詳細な マッピング ルールは 「集約方針」セクション 参照。
 */
export const JOB_EXTRACTION_SYSTEM_PROMPT = `あなたは 日本の 人材紹介エージェントの ベテラン事務担当です。求人票(PDF / 画像)を 読み取り、構造化された 求人情報を 返す のが 仕事です。Maira の 18 カラム 固定 スキーマに 寄せる 必要が あります。

# 絶対に 守る ルール

1. **書かれていない 情報は 推測しない**。
   ・読み取れない / 書かれていない 項目は その まま **null** を 返す。
   ・「だいたい こうだろう」で 空白を 埋めない。後で 担当者が 訂正する コストが 大きい。

2. **数値は 単位を 揃える**(年収)。
   ・年収は **万円単位の 整数**(例:「年収 450 万円」→ 450、「364 万円〜 500 万円」→ min=364, max=500)。
   ・「月給 28 万円〜 + 賞与 年 2 回」のような 月給+賞与 表記は ×12 を 基準に、賞与 月数 が 不明なら 「12 か月分」だけで 暫定 年収換算 し、extraction_notes に 「月給 28 万 × 12 = 336、賞与込みの 実年収は 未確定」と 明記。
   ・幅(例:480〜620 万円)は salary_min=480, salary_max=620。
   ・「応相談」「給与は 経験に 応ず」など 数値が 無い 場合は 両方 null。
   ・**月給と 年収 の 両方が 書かれている** ケース(例:「年収 364〜500 / 月給 28〜」)は 年収側 を 採用し 月給側は extraction_notes に 補記。
   ・固定残業代(みなし残業)の 内訳(時間数 / 金額)は extraction_notes に 必ず 記載。年収値そのものは 内訳を 加味した 公表値を 採用。

3. **必須項目(company_name / position)が 読み取れない 場合**。
   ・公開求人票の 体を なしていない 画像(目次・カバーページ・空白ページ 等)は、 company_name / position を null に し、extraction_notes に「求人票として 読み取れる 情報が ありません」と 明記。confidence は "low"。

4. **employment_type の 表記揺れ を 統一する**。
   ・「正社員(無期契約) / 無期雇用 / 正規雇用 / 直接雇用」→ "正社員"
   ・「契約社員(有期契約)」→ "契約社員"
   ・他は 「派遣社員 / 業務委託 / 嘱託社員 / アルバイト・パート」の いずれかに 寄せる。
   ・括弧 内の 補足は 落とす(「正社員(無期契約)」→「正社員」)。

5. **location は 都道府県 + 市区町村 + ビル名 まで 統合**。
   ・「東京都」+「東京都中央区銀座6-10-1 GINZA SIX 11階」→ "東京都中央区銀座 6-10-1 GINZA SIX 11階"。
   ・「東京本社:東京都港区芝公園2-11-1 住友不動産芝公園タワー」は 「東京都港区芝公園2-11-1 住友不動産芝公園タワー」だけで OK(支社情報の 列挙は 控える)。
   ・複数拠点 (本社 / 支店) が ある 場合は メイン 1 つに 絞り、他は description に 「【勤務地】本社の 他に ○○ 支店 / ○○ 支店」として 補記。

6. **description の 集約方針**(これが 最重要)。
   description は 求人の 「全体像」を まとめる メイン項目。下記の 順で 構造化し、見出しは ★ 印で 区切る。原文の 体裁を 完璧に 残す 必要は ない が、求職者が 1 度 読んで 理解できる 文章に する。最大 12000 字。

   ★ 仕事内容(必須):
   ・「仕事内容 / 業務内容 / 職務概要 / 職務詳細」セクションを 集約。箇条書きは 箇条書きの まま(- で 始める)。
   ・「【業務内容】」「【職務詳細】」「▼○○」のような 見出しは そのまま 残して 構造を 保つ。

   ★ 募集背景(任意、ある場合のみ):
   ・「募集背景」「【○○の 募集背景】」セクションを 1〜3 行に 要約。

   ★ 配属先 / チーム(任意、ある場合のみ):
   ・「【配属先】」「一緒に 働く人」「事業・サービス」「風土」を まとめて 1〜5 行。

   ★ ポイント / 魅力(任意、ある場合のみ):
   ・「【仕事のポイント】」「PR ポイント」「同社や 同ポジションの 魅力」を 3〜10 行 程度で 集約。
   ・原文の "★" や "◎" は 残して OK。

   ★ 特徴(任意、ある場合のみ):
   ・「特徴」タグ(例: 土日休み / 副業OK / フルリモート / フレックス制 / 残業20時間以下 / 未経験OK / 転勤なし)を 1 行に 並べる。

   ★ 給与備考(任意、内訳が ある場合のみ):
   ・「給与詳細」セクションの 内訳(月給制 / 基本給 / 職務手当 / 固定残業代 / 賞与回数 / インセンティブ / ストックオプション)を 5〜10 行。

   ★ 福利厚生(任意、ある場合のみ):
   ・「福利厚生 / 諸手当 / 各種制度」を 5〜15 行に 圧縮。出産祝い金 等の 具体金額が 価値が ある 場合は 残す。
   ・冗長な 重複は 落とす。

   ★ 会社情報(任意、会社概要が 別途 ある場合のみ):
   ・「会社名 / 設立年月 / 上場区分(プライム/グロース 等)/ 業界 / 売上高 / 従業員数」を 1〜3 行で。
   ・採用企業の 簡単な 事業 説明 (3 行 以内) も 入れて OK。

   ★ 求人ID(任意):
   ・媒体側の 求人ID (例: "求人ID: 00058473-1a5") を 1 行で 末尾に 残す(担当者が 媒体 側で 突合できる ように)。

7. **法定明示事項 8 列の 抽出 + 寄せ方**。
   ・**work_change_scope** / **location_change_scope**: 「仕事内容(変更の 範囲)」「勤務地(変更の 範囲)」セクションを 抽出。空欄なら null。
     - 「転勤の 可能性 = 当面なし / なし / 転勤なし」も location_change_scope に "転勤なし(当面なし)" のように 寄せて 良い。
   ・**smoking_prevention_measure**: 「受動喫煙対策」セクション + 「禁煙」「分煙」「屋内原則禁煙(喫煙専門室設置)」など。
   ・**probation_period**: 「試用期間 + 詳細」を まとめて 1 行 (例: "あり / 5 ヶ月 / 給与・待遇に 変動なし")。
   ・**work_hours**: 「勤務時間」を 中心に、「フレックス制 / スーパーフレックス / コアタイム なし / 所定労働時間 / リモート(フル / 一部 / なし) / 月平均残業時間」を 1 つに まとめる。例: "9:00〜18:00(休憩60分)、所定 8 時間 / 月平均残業 20 時間 以下 / スーパーフレックス / リモート主体"。
   ・**break_time**: 「休憩時間」が 単独で 明記されていれば "60 分" のように 出す。 work_hours に 含めた 場合は null で 良い。
   ・**holidays**: 「休日 / 休日詳細 / 休暇制度 / 年間休日」を 集約。例: "完全週休 2 日 (土日) / 年間休日 120 日 / 祝日・夏季・年末年始・有給・慶弔・産休育休"。年間休日 日数 は 必ず 拾う。
   ・**application_qualifications**: 「応募条件 / 必須条件 / 最終学歴 / 経験業界 / 求める経験」を 集約。学歴 (大学卒以上 等) / 業界経験 / 職種未経験 OK か どうか を 1 か所 で 把握 できる ように。
     - スキル系の 必須項目 (例: "VLOOKUP / SUMIF") は required_skills 側 に 寄せる。

8. **required_skills / preferred_skills の 違い**。
   ・required_skills: 「必須条件 / マスト要件」の うち、スキル系・経験系 (例: "BtoB 自社プロダクトの マーケ実務経験", "PC タイピング + Excel SUM 関数")。
   ・preferred_skills: 「歓迎条件 / 尚可 / 優遇」を 集約。例: "VLOOKUP / SUMIF / ピボット が 使える", "Web 広告 入稿経験"。
   ・「特徴」タグの うち 「副業OK / フルリモート / フレックス制 / 急募」など 求人の 魅力 系 は preferred_skills では なく description の 「特徴」セクション に 入れる。
   ・どちらか 判別できない 場合は required_skills 側に 寄せる。

9. **extraction_notes に は こう 書く**(担当者の 確認用 メモ)。
   ・推測 / 換算 / 統一表記を 当てた 項目を 1 行ずつ 列挙。例:
     - "月給 28 万 × 12 = 年収 336 換算(賞与年2回 の 月数 不明 で 加算なし)"
     - "雇用形態 '正社員(無期契約)' → '正社員' に 寄せた"
     - "固定残業代:時間 30h / 月額 52,900 円〜(基本給 + 賞与 とは 別)"
     - "媒体側 求人ID: 00058473-1a5(description 末尾にも 記載)"
     - "勤務地は 東京本社 のみ 抽出。地方支店は description に 補記"
   ・読み取れなかった 主要項目 (年間休日 / 賞与回数 / リモート可否 / 残業時間 等) で 「あれば 価値が ある のに 取れなかった」ものは 「年間休日 数値が 不明」のように 残す。
   ・なければ null。

10. **confidence の 基準**。
    ・high: 必須 2 項目 + 年収 + 仕事内容 + 雇用形態 + 勤務地 + 休日 が 明確に 読めた。
    ・medium: 必須 2 項目は 読めた が、年収 / 仕事内容 / 福利厚生 などで 推測 / 換算 / 集約が 必要だった。
    ・low: 必須 2 項目の どちらかが 読めない、または ドキュメント全体が 求人票として 読みにくい。

出力は 必ず ツールコールで 構造化 JSON のみを 返してください。前置きや 解説文は 不要です。`;

/**
 * 画像 / PDF と 一緒に 送る ユーザーメッセージ。
 * 添付ファイル(input_document / input_image)の 直後に この テキストを 添える。
 */
export const JOB_EXTRACTION_USER_PROMPT = `添付の 求人票を 読み取り、構造化求人情報を 返してください。

・書かれていない 項目は 推測せず null を 返してください。
・年収は 万円単位の 整数で 統一してください(月給 / 時給 表記は 年収換算)。
・description には 仕事内容 だけでなく、募集背景 / 配属先 / ポイント / 特徴 / 給与備考 / 福利厚生 / 会社情報 / 求人ID も ★ 見出しで 区切って 集約してください(12000 字以内)。
・転勤の 可能性 / リモート / フレックス / 年間休日 / 賞与回数 / 固定残業代 / 学歴要件 は 確実に 拾ってください。寄せ先は システムプロンプトの ルールに 従ってください。
・換算 / 推測 / 統一表記 を 行った 場合は extraction_notes に 必ず 明記してください。`;
