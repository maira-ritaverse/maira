/**
 * 対応履歴(client_interactions)の型定義
 *
 * エージェント企業がクライアント(求職者)に対して行った対応(電話・
 * メール・面談など)を記録するための平文データ。
 *
 * ⚠️ ラベル・並びはこのファイルに一元集約する(referrals 型と同じ方針)。
 * 将来 DB のマスター化に移行するときは、コード側のシグネチャを変えずに
 * 切り替えられるよう interactionTypeConfig だけを参照すること。
 */

import { z } from "zod";

export type InteractionType = "call" | "email" | "meeting" | "message" | "note" | "other";

export const interactionTypeConfig: {
  value: InteractionType;
  label: string;
  order: number;
}[] = [
  { value: "call", label: "電話", order: 1 },
  { value: "email", label: "メール", order: 2 },
  { value: "meeting", label: "面談", order: 3 },
  { value: "message", label: "メッセージ", order: 4 },
  { value: "note", label: "メモ", order: 5 },
  { value: "other", label: "その他", order: 99 },
];

export function getInteractionTypeConfig(type: InteractionType) {
  return (
    interactionTypeConfig.find((t) => t.value === type) ??
    interactionTypeConfig[interactionTypeConfig.length - 1]
  );
}

export type ClientInteraction = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  referralId: string | null;
  authorMemberId: string | null;
  interactionType: InteractionType;
  occurredAt: string;
  summary: string | null;
  body: string | null;
  createdAt: string;
  updatedAt: string;
};

// 一覧表示用に記録者の表示名を付与した型
export type ClientInteractionWithAuthor = ClientInteraction & {
  authorName: string | null;
};

// check 制約と一致する zod enum
const interactionTypeEnum = z.enum(["call", "email", "meeting", "message", "note", "other"]);

export const createInteractionRequestSchema = z.object({
  client_record_id: z.string().uuid(),
  referral_id: z.string().uuid().nullable().optional(),
  interaction_type: interactionTypeEnum,
  // occurred_at は ISO 文字列(クライアント側で datetime-local → toISOString)
  occurred_at: z.string().datetime().optional(),
  summary: z.string().max(200).optional().or(z.literal("")),
  body: z.string().max(5000).optional().or(z.literal("")),
});

export type CreateInteractionRequest = z.infer<typeof createInteractionRequestSchema>;

export const updateInteractionRequestSchema = z.object({
  interaction_type: interactionTypeEnum.optional(),
  occurred_at: z.string().datetime().optional(),
  summary: z.string().max(200).optional().or(z.literal("")),
  body: z.string().max(5000).optional().or(z.literal("")),
});

export type UpdateInteractionRequest = z.infer<typeof updateInteractionRequestSchema>;
