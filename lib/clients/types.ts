/**
 * クライアントレコード(企業所有)の型定義
 *
 * ハイブリッド設計:
 *   - 企業が管理する「クライアント情報」は求職者本人のMairaアカウントとは別物
 *   - メール一致 + 求職者オプトインで link_status='linked' に遷移する
 */

import { z } from "zod";

// 二段階解除:revoke_requested は「本人が解除を申請したが猶予期間内」の状態。
// 申請期間中は引き続き開示される(書類/希望条件 RLS は時刻条件付き)。
// 期限超過で開示は自動で止まり、エージェント承認 or cron で revoked に確定する。
export type ClientLinkStatus = "unlinked" | "invited" | "linked" | "revoke_requested" | "revoked";

export type ClientStatus =
  | "initial_meeting"
  | "job_matching"
  | "in_screening"
  | "offer"
  | "completed"
  | "declined";

export const clientStatusLabels: Record<ClientStatus, string> = {
  initial_meeting: "初回面談",
  job_matching: "求人紹介中",
  in_screening: "選考中",
  offer: "内定",
  completed: "転職完了",
  declined: "見送り",
};

export const clientLinkStatusLabels: Record<ClientLinkStatus, string> = {
  unlinked: "未連携",
  invited: "招待済み",
  linked: "連携済み",
  revoke_requested: "解除申請中",
  revoked: "連携解除",
};

// 二段階解除の確定経路を表す監査値。
// agency_approved: エージェントが解除申請を承認して即時 revoked にした(P4)。
// timeout         : 猶予期限を過ぎ cron で自動 revoked にした(P6、未実装)。
export type RevokeConfirmedVia = "agency_approved" | "timeout";

export type ClientRecord = {
  id: string;
  organizationId: string;
  assignedMemberId: string | null;
  name: string;
  email: string;
  phone: string | null;
  status: ClientStatus;
  linkStatus: ClientLinkStatus;
  linkedUserId: string | null;
  linkedAt: string | null;
  revokedAt: string | null;
  // 二段階解除(P3〜P6)で使用。revoke_requested 状態のときに非 null。
  // revoked になると requested_at/deadline は履歴として残し、confirmed_via に
  // どの経路で revoked になったかが入る(P4 承認 or P6 タイムアウト)。
  revokeRequestedAt: string | null;
  revokeDeadline: string | null;
  revokeConfirmedVia: RevokeConfirmedVia | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

// クライアント一覧表示用に担当アドバイザーの表示名を付与した型
// assigneeName が null の場合は「未割当」または display_name 未設定を意味する
export type ClientRecordWithAssignee = ClientRecord & {
  assigneeName: string | null;
};

// クライアント一覧で「期限超過/間近」のバッジを出すために、未完了タスクの
// 期限(due_at)のリストを付与した型。
// 件数の判定は表示時点の現在時刻と比較するため、生の due_at のリストを保持し
// 集計はクライアント側で行う(サーバ固定値だと時間が経つと古くなる)。
// due_at が null のタスクも一律含む(間近/超過の判定対象外として扱う)。
export type ClientRecordWithAssigneeAndDues = ClientRecordWithAssignee & {
  pendingDueAts: (string | null)[];
};

// 応募状況の段階別件数(クライアント一覧の「応募状況」列で使う)。
// referrals.status の値をキーに、件数を保持。
// 0 件の status はキーごと持たない(描画側で「ある段階だけ」を出すため)。
// total は referral 全件(declined 含む)で、応募ゼロ判定に使う。
//
// ⚠️ referral 自体の status は将来カスタマイズ予定(referrals.types のコメント参照)。
// その際にキーが固定 6+1 段階から増減する余地があるので、Partial<Record<>> で持つ。
import type { ReferralStatus } from "@/lib/referrals/types";

export type ReferralBreakdown = {
  byStatus: Partial<Record<ReferralStatus, number>>;
  total: number;
};

// 一覧用に referralBreakdown(応募状況の集計)を追加した拡張型。
// 既存の AssigneeAndDues 由来のフィールドはそのまま継承する。
export type ClientRecordWithReferralBreakdown = ClientRecordWithAssigneeAndDues & {
  referralBreakdown: ReferralBreakdown;
};

// 新着・更新バッジ(案B:メンバー個人単位)用の拡張型。
// 既存の ReferralBreakdown 由来のフィールドはそのまま継承する。
//
// hasUnreadUpdate:
//   本人データ(career_profile / resumes / cvs)の最新更新時刻が
//   自分(閲覧メンバー)の最終閲覧時刻より新しい場合 true。
//   開示範囲外(unlinked/invited、または期限超過 revoke_requested)は常に false。
// latestUpdatedAt:
//   本人データの最新更新時刻(3 種の max)。本人データが無ければ null。
//   一覧でバッジ表示時のツールチップや並び替えに使う余地を残す。
export type ClientRecordWithUpdateBadge = ClientRecordWithReferralBreakdown & {
  hasUnreadUpdate: boolean;
  latestUpdatedAt: string | null;
};

// クライアント登録リクエスト
export const createClientRequestSchema = z.object({
  name: z.string().min(1, "氏名を入力してください").max(100),
  email: z.string().email("正しいメールアドレスを入力してください"),
  phone: z.string().max(20).optional().or(z.literal("")),
  status: z
    .enum(["initial_meeting", "job_matching", "in_screening", "offer", "completed", "declined"])
    .default("initial_meeting"),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;

// クライアント更新リクエスト
export const updateClientRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional().or(z.literal("")),
  status: z
    .enum(["initial_meeting", "job_matching", "in_screening", "offer", "completed", "declined"])
    .optional(),
  assigned_member_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
