/**
 * 紹介(マッチング)の型定義
 *
 * クライアントレコード × 求人 の多対多紐づけ + ステータス管理。
 *
 * ⚠️ ステータス定義(label / 順序 / 色)はこのファイルに一元集約する。
 * 将来「企業ごとにステータスをカスタマイズできる」機能を作るとき、
 * DB のステータスマスターに移行しやすくするため。
 * 画面側はこの referralStatusConfig だけを参照すること。
 */

import { z } from "zod";

export type ReferralStatus =
  | "planned"
  | "recommended"
  | "screening"
  | "interview"
  | "offer"
  | "joined"
  | "declined";

/**
 * 紹介ステータスの一元定義
 * - value: DB に保存される識別子(check 制約と一致)
 * - label: 画面表示
 * - order: 並び順(declined は本筋から外れるので末尾扱い)
 * - className: Tailwind のバッジ色クラス
 *
 * 将来 DB のステータスマスターに置き換えるときは、この配列を
 * 取得するヘルパーを用意して画面側のシグネチャは変えずに移行できる。
 */
export const referralStatusConfig: {
  value: ReferralStatus;
  label: string;
  order: number;
  className: string;
}[] = [
  {
    value: "planned",
    label: "推薦予定",
    order: 1,
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  {
    value: "recommended",
    label: "推薦済",
    order: 2,
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  {
    value: "screening",
    label: "書類選考",
    order: 3,
    className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  },
  {
    value: "interview",
    label: "面接",
    order: 4,
    className: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  },
  {
    value: "offer",
    label: "内定",
    order: 5,
    className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  },
  {
    value: "joined",
    label: "入社",
    order: 6,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  {
    value: "declined",
    label: "見送り",
    order: 99,
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
];

/**
 * status 値から定義を取り出す。
 * 想定外の値が来ても落ちないように planned にフォールバック。
 */
export function getReferralStatusConfig(status: ReferralStatus) {
  return referralStatusConfig.find((s) => s.value === status) ?? referralStatusConfig[0];
}

export type Referral = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  jobPostingId: string;
  status: ReferralStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 求人情報を join して取得する拡張型(クライアント詳細から見るとき) */
export type ReferralWithJob = Referral & {
  jobCompanyName: string;
  jobPosition: string;
};

/** クライアント情報を join して取得する拡張型(求人詳細から見るとき) */
export type ReferralWithClient = Referral & {
  clientName: string;
  clientEmail: string;
};

// ステータス値の zod enum(check 制約と一致)
const referralStatusEnum = z.enum([
  "planned",
  "recommended",
  "screening",
  "interview",
  "offer",
  "joined",
  "declined",
]);

export const createReferralRequestSchema = z.object({
  client_record_id: z.string().uuid(),
  job_posting_id: z.string().uuid(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type CreateReferralRequest = z.infer<typeof createReferralRequestSchema>;

export const updateReferralRequestSchema = z.object({
  status: referralStatusEnum.optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type UpdateReferralRequest = z.infer<typeof updateReferralRequestSchema>;

// ============================================
// 紹介ステータス遷移履歴(referral_status_history)
//
// referrals.status の変更を「いつ・何から何へ・誰が」で残す追記型レコード。
// ラベル表示は上記 referralStatusConfig を再利用するため、
// from/to の文字列は ReferralStatus 互換として扱う(将来のマスター化に備え
// DB 側は text のままで check 制約は付けていない)。
// ============================================

export type ReferralStatusHistory = {
  id: string;
  organizationId: string;
  referralId: string;
  /** 初回(planned 作成時等)は null 可 */
  fromStatus: ReferralStatus | null;
  toStatus: ReferralStatus;
  /** 変更者。担当者が抜けた履歴では null になり得る */
  changedByMemberId: string | null;
  /** 実際に遷移した日時(挿入日時とは別) */
  changedAt: string;
  memo: string | null;
  createdAt: string;
};

/** 履歴一覧で「推薦 → 書類通過」のように表示するためのヘルパー */
export function formatReferralStatusTransition(
  fromStatus: ReferralStatus | null,
  toStatus: ReferralStatus,
): string {
  const toLabel = getReferralStatusConfig(toStatus).label;
  if (!fromStatus) return toLabel;
  const fromLabel = getReferralStatusConfig(fromStatus).label;
  return `${fromLabel} → ${toLabel}`;
}

/**
 * 履歴一覧表示用に、変更者の表示名を合流させた拡張型。
 * client_interactions の ClientInteractionWithAuthor と同じ思想。
 * 変更者がメンバーから外れた等で名前を取れない場合は null。
 */
export type ReferralStatusHistoryWithAuthor = ReferralStatusHistory & {
  changedByName: string | null;
};
