/**
 * AI 種別の 日本語ラベル / scope / 概算コストの 純粋な 定数モジュール。
 *
 * 役割:
 *   ・サーバ専用モジュール(supabase/server 等)を 一切 含まない
 *   ・クライアントコンポーネント / サーバコンポーネントの 両方から 安全に import できる
 *   ・サーバ側で 利用する 集計関数(getOrgAiUsageSummary 等)は
 *     lib/agency/ai-usage-queries.ts に 残し、本ファイルは 定数のみ
 */

export const AI_KIND_LABEL: Record<string, string> = {
  photo_enhance: "AI 証明写真",
  job_recommendation_seeker: "AI 推薦(求職者)",
  job_recommendation_agency: "AI 推薦(エージェント)",
  recommendation_letter_draft: "推薦文 AI 下書き",
  agency_cv_draft: "職務経歴書 AI 下書き",
  agency_resume_draft: "履歴書 AI 下書き",
  job_extract_from_document: "求人 自動取り込み(PDF / 画像)",
  csv_column_mapping: "CSV カラム AI マッピング",
};

/** 上限設定 UI で「組織横断」「求職者 1 人あたり」を 表示する分類 */
export const AI_KIND_SCOPE_LABEL: Record<string, "agency_org" | "seeker_per_user"> = {
  photo_enhance: "seeker_per_user",
  job_recommendation_seeker: "seeker_per_user",
  job_recommendation_agency: "agency_org",
  recommendation_letter_draft: "agency_org",
  agency_cv_draft: "agency_org",
  agency_resume_draft: "agency_org",
  job_extract_from_document: "agency_org",
  csv_column_mapping: "agency_org",
};

/**
 * 1 件あたりの概算コスト(USD)。launch 前の運用判断用、参考値。
 * 実コストは Anthropic / OpenAI の請求と突合せて確認すること。
 */
export const AI_KIND_UNIT_COST_USD: Record<string, number> = {
  photo_enhance: 0.04, // gpt-image-1 medium quality
  job_recommendation_seeker: 0.0135, // Claude Sonnet 4.6, 約 2k input + 500 output
  job_recommendation_agency: 0.0135,
  recommendation_letter_draft: 0.075, // 推薦文は長め(5k input + 2k output 想定)
  agency_cv_draft: 0.045, // CV 下書き(4k input + 1.5k output 想定)
  agency_resume_draft: 0.045,
  job_extract_from_document: 0.13, // Claude vision PDF/画像 (15k input + 1.5k output 想定)
  csv_column_mapping: 0.005, // ヘッダ + 3 行サンプル → 軽量 (1k input + 300 output 想定)
};

export function estimateCostUsd(byKind: Record<string, number>): number {
  let usd = 0;
  for (const [kind, count] of Object.entries(byKind)) {
    const unit = AI_KIND_UNIT_COST_USD[kind] ?? 0;
    usd += unit * count;
  }
  return Math.round(usd * 100) / 100;
}
