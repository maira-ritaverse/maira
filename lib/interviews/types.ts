/**
 * interviews (1 応募 × 複数 面接 ラウンド) の 型 と Zod スキーマ。
 *
 * DB は supabase/migrations/20260629000008_add_interviews_and_birthday.sql。
 * kind = 'first' | 'second' | 'final' | 'offer' | 'company'
 * result = 'scheduled' | 'done' | 'canceled' | 'no_show'
 */
import { z } from "zod";

export const interviewKindEnum = z.enum(["first", "second", "final", "offer", "company"]);
export type InterviewKind = z.infer<typeof interviewKindEnum>;

export const interviewResultEnum = z.enum(["scheduled", "done", "canceled", "no_show"]);
export type InterviewResult = z.infer<typeof interviewResultEnum>;

export const KIND_LABEL: Record<InterviewKind, string> = {
  first: "1次 面接",
  second: "2次 面接",
  final: "最終 面接",
  offer: "内定 面談",
  company: "企業 面談",
};

export const RESULT_LABEL: Record<InterviewResult, string> = {
  scheduled: "予定",
  done: "実施 済",
  canceled: "中止",
  no_show: "不参加",
};

/**
 * 新規 作成 リクエスト。 referral_id + kind + scheduled_at が 必須。
 * organization_id は サーバ側 で 呼び出し者 の org に 固定 する ため body から は 受けない。
 */
export const createInterviewRequestSchema = z.object({
  referral_id: z.string().uuid(),
  kind: interviewKindEnum,
  scheduled_at: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateInterviewRequest = z.infer<typeof createInterviewRequestSchema>;

/**
 * 部分 更新。 result 変更 が 主 な ユース ケース (「1 次 通過 = done」)。
 */
export const updateInterviewRequestSchema = z.object({
  kind: interviewKindEnum.optional(),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
  result: interviewResultEnum.optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateInterviewRequest = z.infer<typeof updateInterviewRequestSchema>;

export type Interview = {
  id: string;
  organizationId: string;
  referralId: string;
  kind: InterviewKind;
  scheduledAt: string;
  result: InterviewResult;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};
