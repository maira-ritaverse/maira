/**
 * 推薦文(recommendation_letters)の型と zod スキーマ
 *
 * DB スキーマ:
 *   - supabase/migrations/20260628000001_add_recommendation_letter_templates.sql
 *   - supabase/migrations/20260628000002_add_recommendation_letters.sql
 *
 * 暗号化境界:
 *   ・本ファイルは「復号後のドメイン型」を扱う。
 *   ・暗号化 / 復号は lib/recommendation-letters/queries.ts で実施。
 *   ・rowToDecryptedLetter は queries 側に置く(本ファイルは zod スキーマと型のみ)。
 *
 * 文字数上限の根拠:
 *   ・body 8000 字:長文の推薦状でも余裕(企業向け正式文書は 400〜2000 字が一般的)。
 *   ・headline 200 字:件名相当の見出し。
 *   ・DB の check 制約は暗号化後の base64 オーバーヘッドを見て 16000 / 1000 にしている。
 */
import { z } from "zod";

// ===========================================================================
// 推薦文本体
// ===========================================================================

export type RecommendationLetterStatus = "draft" | "finalized";

export type RecommendationLetter = {
  id: string;
  organizationId: string;
  referralId: string;
  version: number;
  status: RecommendationLetterStatus;
  /** 復号済本文(API レイヤで decryptField してから返す) */
  body: string;
  /** 復号済件名 */
  headline: string;
  templateId: string | null;
  createdByMemberId: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 履歴一覧表示用(本文は復号せず長さだけ返す軽量版) */
export type RecommendationLetterSummary = {
  id: string;
  referralId: string;
  version: number;
  status: RecommendationLetterStatus;
  templateId: string | null;
  createdByMemberId: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** ステータス → 日本語ラベル + バッジ色。lib/referrals/types.ts と同じ思想。 */
export const recommendationLetterStatusConfig: {
  value: RecommendationLetterStatus;
  label: string;
  className: string;
}[] = [
  {
    value: "draft",
    label: "下書き",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  {
    value: "finalized",
    label: "確定済",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
];

export function getRecommendationLetterStatusConfig(status: RecommendationLetterStatus) {
  return (
    recommendationLetterStatusConfig.find((s) => s.value === status) ??
    recommendationLetterStatusConfig[0]
  );
}

// ===========================================================================
// zod スキーマ:API 入力検証
// ===========================================================================

/**
 * 新規作成リクエスト
 *
 * referralId は URL パラメータから取得するのでボディに含めない。
 * headline / body は空文字で開始可(エディタで空のドラフトを作るユースケース)。
 * テンプレ指定があれば紐づける。
 */
export const createRecommendationLetterRequestSchema = z.object({
  headline: z.string().max(200).default(""),
  body: z.string().max(8000).default(""),
  template_id: z.string().uuid().nullable().optional(),
});

export type CreateRecommendationLetterRequest = z.infer<
  typeof createRecommendationLetterRequestSchema
>;

/**
 * 部分更新リクエスト(自動保存対応)
 *
 * status を 'finalized' に変えると finalizeLetter ルートで finalized_at をセットする。
 * 直接 PATCH で finalized にする経路は finalizeSchema 経由(別ルート想定だが
 * シンプルさのため PATCH に統合し、サーバ側で finalized_at を set する運用にする)。
 */
export const updateRecommendationLetterRequestSchema = z.object({
  headline: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  template_id: z.string().uuid().nullable().optional(),
  status: z.enum(["draft", "finalized"]).optional(),
});

export type UpdateRecommendationLetterRequest = z.infer<
  typeof updateRecommendationLetterRequestSchema
>;

// ===========================================================================
// テンプレート
// ===========================================================================

export type RecommendationLetterTemplate = {
  id: string;
  organizationId: string;
  name: string;
  /** 冒頭定型句(平文)。テンプレ自体は機密情報を含まないため暗号化しない。 */
  prefixBody: string;
  /** 末尾定型句(平文)。 */
  suffixBody: string;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const createRecommendationLetterTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  prefix_body: z.string().max(2000),
  suffix_body: z.string().max(2000),
});

export type CreateRecommendationLetterTemplateRequest = z.infer<
  typeof createRecommendationLetterTemplateSchema
>;

export const updateRecommendationLetterTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  prefix_body: z.string().max(2000).optional(),
  suffix_body: z.string().max(2000).optional(),
});

export type UpdateRecommendationLetterTemplateRequest = z.infer<
  typeof updateRecommendationLetterTemplateSchema
>;

// ===========================================================================
// DB 行 → ドメイン型マッパー(平文部分のみ)
//
// 暗号化フィールド(body / headline)を含む RecommendationLetter は
// queries.ts 側で decrypt してから組み立てる(本ファイルは平文の型変換のみ)。
// ===========================================================================

export type RecommendationLetterRow = {
  id: string;
  organization_id: string;
  referral_id: string;
  version: number;
  status: string;
  encrypted_body: string;
  encrypted_headline: string;
  template_id: string | null;
  created_by_member_id: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
};

/** 履歴一覧で使う軽量変換(本文は復号しない) */
export function rowToRecommendationLetterSummary(
  row: RecommendationLetterRow,
): RecommendationLetterSummary {
  return {
    id: row.id,
    referralId: row.referral_id,
    version: row.version,
    status: row.status as RecommendationLetterStatus,
    templateId: row.template_id,
    createdByMemberId: row.created_by_member_id,
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type RecommendationLetterTemplateRow = {
  id: string;
  organization_id: string;
  name: string;
  prefix_body: string;
  suffix_body: string;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToRecommendationLetterTemplate(
  row: RecommendationLetterTemplateRow,
): RecommendationLetterTemplate {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    prefixBody: row.prefix_body,
    suffixBody: row.suffix_body,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
