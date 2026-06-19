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
const nullableShortText = z.string().max(200).nullable();
const nullableLongText = z.string().max(5000).nullable();
const nullableLabourField = z.string().max(2000).nullable();

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
 */
export const JOB_EXTRACTION_SYSTEM_PROMPT = `あなたは 日本の 人材紹介エージェントの 事務担当です。求人票(PDF / 画像)を 読み取り、構造化された 求人情報を 返す のが 仕事です。

# 絶対に 守る ルール

1. **書かれていない 情報は 推測しない**。
   ・読み取れない / 書かれていない 項目は その まま **null** を 返す。
   ・「だいたい こうだろう」で 空白を 埋めない。後で 担当者が 訂正する コストが 大きい。

2. **数値は 単位を 揃える**。
   ・年収は **万円単位の 整数**(例:「年収 450 万円」→ 450)。
   ・「月給 30 万円」「時給 1500 円」など 月給 / 時給 表記は **年収換算** して 出力する。
     - 月給は ×12 で 年収に 換算(賞与・手当が 明記されていれば 加算)。
     - 時給の 場合は 「フルタイム 月 160h × 12 = 年 1920h」を 仮定して 換算 する が、
       こうした 換算を 行った 場合は extraction_notes に 必ず 「時給 1500 円を 年収換算」のように 明記。
   ・幅(例:400 〜 600 万円)は salary_min=400, salary_max=600。
   ・「応相談」「給与は 経験に 応ず」など 数値が 無い 場合は 両方 null。

3. **必須項目(company_name / position)が 読み取れない 場合**。
   ・公開求人票の 体を なしていない 画像(目次・カバーページ・空白ページ 等)は、
     company_name / position を null に し、extraction_notes に「求人票として 読み取れる
     情報が ありません」と 明記。confidence は "low"。

4. **employment_type の 表記揺れ を 統一する**。
   ・「正社員 / 契約社員 / 派遣社員 / 業務委託 / 嘱託社員 / アルバイト・パート」の いずれかに 寄せる。
   ・「正規雇用」「直接雇用」など は 文脈に 応じて 「正社員」に 寄せる。

5. **description は 「仕事内容」 セクション の 主旨を 簡潔に**。
   ・原文を 800 字程度に 要約。
   ・箇条書きが ある 場合は 箇条書きの まま 残す(- で 始める)。
   ・「自社サービス」「裁量労働制」「リモート可」など 求人の 特徴に なる キーワードは 必ず 残す。

6. **法定明示事項 8 列の 抽出**。
   ・work_change_scope / location_change_scope は 2024 年改正労基法対応の
     「業務 / 就業場所の 変更の 範囲」項目。原文に「変更の 範囲」「将来の 配置転換」など
     の キーワードが あれば そこから 抽出。無ければ null。
   ・smoking_prevention_measure は「屋内禁煙」「分煙」「喫煙ルームあり」など。
   ・probation_period は「試用期間 3 ヶ月」のような 文字列を そのまま。
   ・work_hours / break_time / holidays は 原文の 表記を 尊重して 抽出。
   ・application_qualifications は 「応募資格」「必須条件」セクションの 内容を 抽出。
     ・「必須スキル」と 重複が ある 場合は、required_skills 側に 寄せて application_qualifications は null。

7. **required_skills / preferred_skills の 違い**。
   ・required_skills:「必須」「マスト」「要件」と 明記された もの。
   ・preferred_skills:「歓迎」「尚可」「優遇」と 明記された もの。
   ・どちらか 判別できない 場合は required_skills 側に 寄せる。

8. **extraction_notes に は こう 書く**。
   ・推測で 換算した / 統一表記を 当てた / 読み取れなかった 項目を 1 行ずつ 列挙。
   ・空欄が 多くて も、何が 読めなかったか が 担当者に 伝わる ように 書く。
   ・なければ null。

9. **confidence の 基準**。
   ・high:必須 2 項目 + 年収 + 仕事内容 + 雇用形態 が 明確に 読めた。
   ・medium:必須 2 項目は 読めた が、年収 / 仕事内容 等で 推測 / 換算が 必要だった。
   ・low:必須 2 項目の どちらかが 読めない、または ドキュメント全体が 求人票として 読みにくい。

出力は 必ず ツールコールで 構造化 JSON のみを 返してください。前置きや 解説文は 不要です。`;

/**
 * 画像 / PDF と 一緒に 送る ユーザーメッセージ。
 * 添付ファイル(input_document / input_image)の 直後に この テキストを 添える。
 */
export const JOB_EXTRACTION_USER_PROMPT = `添付の 求人票を 読み取り、構造化求人情報を 返してください。

書かれていない 項目は 推測せず null を 返してください。
年収は 万円単位の 整数で 統一してください(月給 / 時給 表記は 年収換算)。
換算 / 推測を 行った 場合は extraction_notes に 必ず 明記してください。`;
