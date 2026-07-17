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
  agency_recording_processed: "面談録音 AI 処理(月 50 件)",
  agency_client_summary: "クライアント詳細 AI 状況サマリー",
  agency_line_reply_suggest: "LINE 返信案 AI 提案",
  agency_line_client_extract: "LINE 会話から CRM 情報 抽出",
  agency_ma_flow_generation: "Flow ビルダー AI 生成",
  agency_ma_segment_generation: "Segment ビルダー AI 生成",
  agency_ma_flow_improvement: "Flow 改善 提案 AI",
  agency_client_document_extract: "求職者 元書類 → プロフィール AI 反映",
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
  agency_recording_processed: "agency_org",
  agency_client_summary: "agency_org",
  agency_line_reply_suggest: "agency_org",
  agency_line_client_extract: "agency_org",
  agency_ma_flow_generation: "agency_org",
  agency_ma_segment_generation: "agency_org",
  agency_ma_flow_improvement: "agency_org",
  agency_client_document_extract: "agency_org",
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
  agency_recording_processed: 0.58, // Whisper $0.36 (60min) + Claude $0.22 (3 コール)
  agency_client_summary: 0.015, // 軽量 ストリーミング (約 2k input + 800 output 想定)
  agency_line_reply_suggest: 0.012, // Claude 短会話 (約 1.5k input + 500 output 想定)
  agency_line_client_extract: 0.015, // 会話 全 30 件 + JSON 出力 (約 2k input + 500 output 想定)
  agency_ma_flow_generation: 0.05, // Claude 構造 化 出力 (約 3k input + 2k output 想定)
  agency_ma_segment_generation: 0.03, // Claude 構造 化 (約 2k input + 1k output 想定)
  agency_ma_flow_improvement: 0.06, // Flow 全体 を レビュー (約 4k input + 2k output 想定)
  agency_client_document_extract: 0.13, // Claude vision PDF/画像、 求人抽出 と 同等
};

export function estimateCostUsd(byKind: Record<string, number>): number {
  let usd = 0;
  for (const [kind, count] of Object.entries(byKind)) {
    const unit = AI_KIND_UNIT_COST_USD[kind] ?? 0;
    usd += unit * count;
  }
  return Math.round(usd * 100) / 100;
}
