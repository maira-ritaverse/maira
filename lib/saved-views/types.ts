/**
 * 保存ビュー(saved_views)の型 + zod スキーマ
 *
 * クライアント一覧のフィルタ条件を「マイビュー」として保存し、
 * 後から 1 クリックで復元するための個人ストレージ。
 *
 * DB スキーマは supabase/migrations/20260615130001_add_saved_views.sql。
 * filters は jsonb で、本ファイルの clientFiltersJsonSchema に従う構造。
 *
 * 注意:
 *   - filters 内のキーは「将来削除されたフィルタ軸」も無視できるように
 *     全て optional にする。ロード時に未知キー / 欠損キーは default に倒す。
 */
import { z } from "zod";

import type {
  SilenceFilter,
  SortColumn,
  SortDirection,
  StatusFilter,
} from "@/lib/clients/filter-sort";

// ────────────────────────────────────────────
// リソース(将来 'jobs' 等にも拡張する余地)
// ────────────────────────────────────────────
export type SavedViewResource = "clients";

// ────────────────────────────────────────────
// クライアント一覧用フィルタ条件の JSON 表現
//   ・全て optional(欠損は呼び出し側で default に倒す)
//   ・FilterSortOptions のうち、永続化したい値だけを残す
//   ・now は実行時の現在時刻を使うので保存しない
// ────────────────────────────────────────────
export type ClientFiltersJson = {
  searchQuery?: string;
  statusFilter?: StatusFilter;
  entrySiteFilter?: string;
  prefectureFilter?: string;
  employmentTypeFilter?: string;
  silenceFilter?: SilenceFilter;
  /** CRM 自由タグ(AND 条件)。空配列または未指定は絞らない。 */
  tagFilter?: string[];
  sortColumn?: SortColumn;
  sortDirection?: SortDirection;
};

export const clientFiltersJsonSchema = z.object({
  searchQuery: z.string().max(200).optional(),
  statusFilter: z
    .enum([
      "all",
      "initial_meeting",
      "job_matching",
      "in_screening",
      "offer",
      "completed",
      "declined",
    ])
    .optional(),
  entrySiteFilter: z.string().max(100).optional(),
  prefectureFilter: z.string().max(100).optional(),
  employmentTypeFilter: z.string().max(100).optional(),
  silenceFilter: z.enum(["all", "14d", "30d", "60d", "90d", "never"]).optional(),
  // CRM タグの個数は 50、各タグ最大 50 文字に制約(誤投入で巨大ペイロードを防止)
  tagFilter: z.array(z.string().min(1).max(50)).max(50).optional(),
  sortColumn: z.enum(["name", "status", "createdAt"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
});

// ────────────────────────────────────────────
// SavedView 型(API レスポンスの正規化)
// ────────────────────────────────────────────
export type SavedView = {
  id: string;
  userId: string;
  organizationId: string;
  resource: SavedViewResource;
  name: string;
  filters: ClientFiltersJson;
  createdAt: string;
  updatedAt: string;
};

// ────────────────────────────────────────────
// 作成リクエスト(POST /api/agency/saved-views)
//
// 同名(user_id × resource × name)はユニーク制約で弾かれる。
// クライアント側で「上書きしますか?」を聞くか、API が 409 を返す。
// ここではシンプルに 409 を返す方針(UI で削除→再作成、あるいは別名)。
// ────────────────────────────────────────────
export const createSavedViewRequestSchema = z.object({
  resource: z.literal("clients"),
  name: z.string().min(1, "名前を入力してください").max(100),
  filters: clientFiltersJsonSchema,
});
export type CreateSavedViewRequest = z.infer<typeof createSavedViewRequestSchema>;
