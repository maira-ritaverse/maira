/**
 * CSV ヘッダ → Myaira 標準カラムへの マッピング 提案 プロンプト + zod schema
 *
 * 役割:
 *   ・任意フォーマットの CSV(ヘッダー名が 媒体ごとに 違う、英語 / 日本語 混在 など)を
 *     Myaira 内部の 標準カラム(snake_case)に 対応付ける ための AI 推論。
 *   ・確実性が 高い alias は 既存の HEADER_ALIASES(import API 側)で 同期取得 する 仕様。
 *     AI は 「alias に 載っていない / 表記揺れ している」ヘッダー専用と 考えれば 良い が、
 *     UX としては 「とりあえず 全部の ヘッダーを 投げて 全部 マッピングしてもらう」方が
 *     ユーザーが ヘッダー名を 見比べる 手間が 減るので、AI には 全件を 渡して 全件 提案させる。
 *
 * 入力:
 *   ・target: "clients" | "jobs"
 *   ・csvHeaders: 検出された 元ヘッダー(順序を 保つ)
 *   ・sampleRows: 最初の 1〜3 行(中身を 見て 推論する 用、空 OK)
 *
 * 出力:
 *   ・mappings: Array<{ csvHeader, canonical | null, confidence }>
 *     - canonical = null は「該当 標準カラムなし」(=取り込み時に 無視)
 *     - confidence: high / medium / low(UI で 強調表示の 目安)
 */

import { z } from "zod";

/**
 * 取り込み対象の リソース種別。
 * clients(顧客名簿)と jobs(求人)で 標準カラムが 異なる ので、target で 出し分け。
 */
export type CsvMapTarget = "clients" | "jobs";

/**
 * Myaira 内部の 標準カラム一覧。
 * import API の HEADER_ALIASES の canonical key と 完全に 一致させる:
 *   ・clients:/api/agency/import/clients/route.ts(8 カラム)
 *   ・jobs:/api/agency/import/jobs/route.ts(18 カラム)
 * ここを 拡張したら API 側も 同期して 更新する 約束(片方だけ 増やしても 機能しない)。
 */
export const CSV_CANONICAL_COLUMNS: Record<CsvMapTarget, ReadonlyArray<CanonicalColumn>> = {
  clients: [
    // 基本 属性
    { key: "name", label: "氏名", required: true },
    { key: "name_kana", label: "氏名カナ / フリガナ", required: false },
    { key: "email", label: "メールアドレス", required: true },
    { key: "phone", label: "電話番号", required: false },
    { key: "phone2", label: "副電話番号(電話番号 2)", required: false },
    { key: "email2", label: "副メールアドレス(メール 2)", required: false },
    { key: "birth_date", label: "生年月日(YYYY-MM-DD)", required: false },
    { key: "gender", label: "性別", required: false },
    { key: "nationality", label: "国籍", required: false },
    { key: "marital_status", label: "配偶者 / 婚姻状況", required: false },
    // 住所
    { key: "postal_code", label: "郵便番号", required: false },
    { key: "prefecture", label: "都道府県", required: false },
    { key: "city", label: "市区町村", required: false },
    { key: "street", label: "番地 / 町名", required: false },
    { key: "building", label: "建物 / マンション名", required: false },
    // 現職 情報
    { key: "current_employment_type", label: "現職雇用形態 / 雇用形態", required: false },
    { key: "current_annual_income", label: "現年収 / 現在年収(万円)", required: false },
    { key: "final_education", label: "最終学歴 / 学歴", required: false },
    // 希望 条件
    { key: "desired_industries", label: "希望業種(複数可)", required: false },
    { key: "desired_occupations", label: "希望職種(複数可)", required: false },
    { key: "desired_locations", label: "希望勤務地(複数可)", required: false },
    { key: "desired_annual_income", label: "希望年収(万円)", required: false },
    { key: "job_change_timing", label: "転職希望時期", required: false },
    // 経験
    { key: "experience_industries", label: "経験業種(複数可)", required: false },
    { key: "experience_occupations", label: "経験職種(複数可)", required: false },
    // 運用 キー日付
    { key: "intake_date", label: "受付日(YYYY-MM-DD)", required: false },
    { key: "first_meeting_date", label: "初回面談日(YYYY-MM-DD)", required: false },
    // その他
    { key: "entry_site", label: "媒体 / エントリーサイト", required: false },
    { key: "crm_tags", label: "CRM タグ(自由タグ、複数可)", required: false },
    { key: "notes", label: "備考 / メモ", required: false },
    // 担当 アドバイザー (別担当 に アサインしたい 時のみ)
    { key: "assignee_email", label: "担当アドバイザーのメールアドレス", required: false },
  ],
  jobs: [
    { key: "company_name", label: "求人企業名 / 会社名", required: true },
    { key: "position", label: "職種 / ポジション", required: true },
    { key: "location", label: "勤務地", required: false },
    { key: "employment_type", label: "雇用形態", required: false },
    { key: "salary_min", label: "年収下限(万円)", required: false },
    { key: "salary_max", label: "年収上限(万円)", required: false },
    { key: "description", label: "仕事内容 / 業務内容", required: false },
    { key: "required_skills", label: "必須スキル", required: false },
    { key: "preferred_skills", label: "歓迎スキル / 歓迎条件", required: false },
    { key: "application_qualifications", label: "応募資格", required: false },
    { key: "probation_period", label: "試用期間", required: false },
    { key: "work_hours", label: "勤務時間", required: false },
    { key: "break_time", label: "休憩時間", required: false },
    { key: "holidays", label: "休日休暇", required: false },
    { key: "work_change_scope", label: "業務(変更の範囲)", required: false },
    { key: "location_change_scope", label: "就業場所(変更の範囲)", required: false },
    { key: "smoking_prevention_measure", label: "受動喫煙防止措置", required: false },
    { key: "status", label: "ステータス(open / paused / closed)", required: false },
  ],
};

export type CanonicalColumn = {
  key: string;
  label: string;
  required: boolean;
};

/**
 * AI 出力用 zod schema(generateObject に 渡す)。
 * 1 つの csvHeader に 対し 0 or 1 の canonical を 紐づける(多対 1 マッピングは 取らない)。
 * canonical = null は 「対応 標準カラム なし → 取り込み時に 無視」。
 */
export const csvMappingResultSchema = z.object({
  mappings: z.array(
    z.object({
      csvHeader: z.string().min(1).max(200),
      canonical: z.string().min(1).max(50).nullable(),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string().max(200).nullable(),
    }),
  ),
});

export type CsvMappingResult = z.infer<typeof csvMappingResultSchema>;

/**
 * プロンプト本文を 動的に 組み立てる。
 * 標準カラム一覧 + 検出ヘッダー + サンプル数行 を 1 つの ユーザーメッセージに まとめる。
 *
 * 「分からないものは null」を 強調する。エージェントが 後で 確認 / 修正する 前提なので、
 * AI が 無理に 寄せて 別カラムに マッピングする 方が 害が 大きい。
 */
export function buildCsvMapPrompt(input: {
  target: CsvMapTarget;
  csvHeaders: string[];
  sampleRows: ReadonlyArray<Record<string, string>>;
}): { system: string; prompt: string } {
  const cols = CSV_CANONICAL_COLUMNS[input.target];
  const targetLabel = input.target === "clients" ? "顧客名簿(求職者)" : "求人情報";

  const system = `あなたは 日本の 人材紹介エージェントの 事務担当 兼 データ整理 専門家です。
利用者が CSV ファイルを 取り込もうとして いますが、ヘッダー名が 媒体 / 自社 入力で バラバラです。
あなたの 仕事は、CSV ヘッダーを Myaira 内部の 「標準カラム」に 1 対 0 / 1 で 対応付ける ことです。

# 絶対に 守る ルール

1. **対応する 標準カラムが 無い ヘッダーは canonical=null** を 返す。
   ・無理に 寄せず、null を 返した 上で confidence="low"、reason="該当 標準カラムなし" と 書く。
   ・後で 担当者が 手動で 確認するため、迷ったら null。

2. **1 つの 標準カラムに 2 つ以上の CSV ヘッダーが マッピング される 場合**。
   ・最も 確度の 高い 1 つ だけを 紐付け、残りは canonical=null + reason に 「<別ヘッダー> と 重複」と 明記。

3. **confidence の 基準**。
   ・high:ヘッダー名 / サンプル値 から 標準カラムが ほぼ 確実(例: "Email" → email)
   ・medium:推測は 立つ が 別解の 余地が ある(例: "氏名(漢字)" → name)
   ・low:サンプル値 / 文脈 から 弱い 推測しか できない、または 対応なし

4. **数値カラムは サンプル値で 検算**。
   ・例: salary_min / salary_max は "300" "500" のような 数値文字列。サンプル値が 全て 数値で 「年収」「給与」を 連想させる ヘッダーなら 寄せて 良い。

5. **理由(reason)は 30 字以内で 端的に**。
   ・「ヘッダー名が 一致」「サンプル値が 数値で 年収帯」など、判断根拠を 1 行で。

6. **出力は 必ず ツールコールで JSON のみ**。前置きは 不要。`;

  const colsBlock = cols
    .map((c) => `  - ${c.key}: ${c.label}${c.required ? " [必須]" : ""}`)
    .join("\n");

  // サンプル行は ヘッダー軸に 並べ替えて 表示(縦長で 読みやすく)。3 行で 十分。
  const sampleBlock = input.sampleRows.length
    ? input.csvHeaders
        .map((h) => {
          const vals = input.sampleRows
            .slice(0, 3)
            .map((r) => r[h] ?? "")
            .map((v) => (v.length > 30 ? v.slice(0, 30) + "…" : v));
          return `  ・${h}:[${vals.map((v) => `"${v}"`).join(", ")}]`;
        })
        .join("\n")
    : "(サンプル なし)";

  const prompt = `# 取り込み対象
${targetLabel}

# Myaira の 標準カラム
${colsBlock}

# 検出された CSV ヘッダー(順序保持)
${input.csvHeaders.map((h, i) => `  ${i + 1}. "${h}"`).join("\n")}

# 各ヘッダーの サンプル値(先頭 3 行)
${sampleBlock}

# 出力
全ヘッダー(${input.csvHeaders.length} 件)に 対する mappings 配列を 返してください。
順序は 入力ヘッダー 順を 保ってください。`;

  return { system, prompt };
}
