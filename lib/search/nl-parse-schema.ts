/**
 * 自然文検索 (Tier 4) の Zod スキーマ。
 *
 * Claude Haiku 4.5 に generateObject で強制する出力形式。
 * ・fixed enum は z.enum で縛る (面接ステータス / 労働形態 / 求人ステータス 等)。
 * ・org 単位で動的に変わる語彙 (entrySite / prefecture / crmTags) は string / string[] で
 *   受けて、後段の validate 層で「実在する値のみに切り詰め」する。
 * ・全フィールドを default 付きにして、AI が一部欄を落としても schema 通過するようにする
 *   (generateObject の再試行を減らしトークンを節約)。
 */

import { z } from "zod";

// ============================================
// 求人検索
// ============================================

export const jobStatusFilterSchema = z.enum(["all", "open", "paused", "closed"]);

export const jobSearchFiltersSchema = z.object({
  /** フリーテキスト検索。会社名 / 職種 / 勤務地 / description / スキル欄に AND 部分一致。 */
  searchQuery: z.string().default(""),
  /** 求人ステータス。"all" で絞らない (未指定と同義)。 */
  statusFilter: jobStatusFilterSchema.default("all"),
  /** 勤務地キーワード (「リモート」「東京」等)。単一文字列で location カラムに部分一致。 */
  locationKeyword: z.string().default(""),
  /** 年収下限 (万円単位、整数)。null は絞らない。 */
  minSalary: z.number().int().min(0).max(100000).nullable().default(null),
  /** 年収上限 (万円単位、整数)。null は絞らない。 */
  maxSalary: z.number().int().min(0).max(100000).nullable().default(null),
  /** どのフィルタにも変換できなかった残り語句 (フリーテキスト検索へフォールバック済み)。 */
  remainingText: z.string().default(""),
  /** high = すべて解釈できた / low = 一部を remainingText に落とした・enum に無い値を推測した。 */
  confidence: z.enum(["high", "low"]).default("high"),
});

export type JobSearchFilters = z.infer<typeof jobSearchFiltersSchema>;

// ============================================
// クライアント検索
// ============================================

export const clientStatusFilterSchema = z.enum([
  "all",
  "initial_meeting",
  "job_matching",
  "in_screening",
  "offer",
  "completed",
  "declined",
]);

export const clientEmploymentTypeFilterSchema = z.enum([
  "all",
  "unset",
  "full_time",
  "contract",
  "temporary",
  "part_time",
  "business_outsource",
  "self_employed",
  "unemployed",
  "student",
  "other",
]);

export const silenceFilterSchema = z.enum(["all", "14d", "30d", "60d", "90d", "never"]);

export const clientSearchFiltersSchema = z.object({
  searchQuery: z.string().default(""),
  statusFilter: clientStatusFilterSchema.default("all"),
  /** エントリー元。org 単位の動的値 (媒体名) なので string。"all"/"unset" 特殊値も受ける。 */
  entrySiteFilter: z.string().default("all"),
  /** 都道府県。単一。"all"/"unset" 特殊値。 */
  prefectureFilter: z.string().default("all"),
  employmentTypeFilter: clientEmploymentTypeFilterSchema.default("all"),
  silenceFilter: silenceFilterSchema.default("all"),
  /** CRM 自由タグ (AND 条件)。org 単位の動的値。 */
  tagFilter: z.array(z.string()).default([]),
  remainingText: z.string().default(""),
  confidence: z.enum(["high", "low"]).default("high"),
});

export type ClientSearchFilters = z.infer<typeof clientSearchFiltersSchema>;

// ============================================
// リクエスト共通
// ============================================

export const nlParseRequestSchema = z.object({
  resource: z.enum(["jobs", "clients"]),
  query: z.string().min(1).max(500),
});
export type NlParseRequest = z.infer<typeof nlParseRequestSchema>;
