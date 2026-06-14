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

// クローズ理由のカテゴリ(失注分析・KPI 集計用)。
// マイグレーション 20260615000005 で client_records.close_reason に CHECK 制約付きで導入。
export type ClientCloseReason =
  | "declined" // 他社サービス選択(競合に取られた)
  | "self_arranged" // 自己応募・自力で決定
  | "other_agency" // 他社エージェント経由で決定
  | "unresponsive" // 連絡途絶
  | "ineligible" // 条件不一致(マッチング不能)
  | "completed" // 自社経由で転職完了(成約)
  | "other"; // その他

export const clientCloseReasonLabels: Record<ClientCloseReason, string> = {
  declined: "他社サービス選択",
  self_arranged: "自己応募・自力で決定",
  other_agency: "他社エージェント経由",
  unresponsive: "連絡途絶",
  ineligible: "条件不一致",
  completed: "自社経由で成約",
  other: "その他",
};

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
  // 失注分析用。null = まだクローズ理由が未確定。
  closeReason: ClientCloseReason | null;
  // MA 自動配信の抑制フラグ。false なら ma-send-campaign 側で除外される。
  // DB の default は true なので、明示的に false を選ばない限り配信対象。
  emailDistributionEnabled: boolean;
  // 平文。リクナビ / ビズリーチ等の出典。集計用なので一覧クエリにも含める。
  entrySite: string | null;
  // 「他社エージェント利用状況」が **入力済みかどうか**(値そのものは含めない)。
  // 一覧で「⚠ 他社利用中」バッジを出すために使う。
  // 復号は N+1 になるので、暗号文の null 判定だけで「存在のみ」を導出する設計。
  hasOtherAgencyStatus: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * 詳細画面用の拡張型(暗号化フィールドを復号して載せたもの)。
 *
 * 一覧クエリでは N+1 復号を避けるためにこれらを取得しない。
 * 詳細クエリ(`getClientRecordWithDecrypted`)だけがこの型を返す。
 *
 * null は「未入力」を意味する(暗号化された値が空文字でも `null` で保存する方針)。
 */
export type ClientRecordWithDecrypted = ClientRecord & {
  recommendationComment: string | null;
  otherAgencyStatus: string | null;
  contactMethodPreference: string | null;
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
  // 登録時から入力可能にする 2 つ(他の新規列は編集画面で追加してもらう)。
  // entry_site:出典の集計に使うため新規登録時の入力が望ましい。
  // email_distribution_enabled:DB の default は true。明示 false を選びたいときだけ送る。
  entry_site: z.string().max(100).optional().or(z.literal("")),
  email_distribution_enabled: z.boolean().default(true),
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
  // 失注分析用。""(空文字)→ null 扱い(UI のセレクトで「未設定」を選んだケース)。
  close_reason: z
    .enum([
      "declined",
      "self_arranged",
      "other_agency",
      "unresponsive",
      "ineligible",
      "completed",
      "other",
    ])
    .nullable()
    .optional(),
  // MA 配信抑制フラグ。false で MA から除外。
  email_distribution_enabled: z.boolean().optional(),
  // EMPRO 観察項目。サーバー側で暗号化して保存(API ルートで encryptField)。
  // 空文字は null として保存(暗号化された "" は不要)。
  recommendation_comment: z.string().max(5000).optional().or(z.literal("")),
  other_agency_status: z.string().max(2000).optional().or(z.literal("")),
  contact_method_preference: z.string().max(1000).optional().or(z.literal("")),
  // 平文。エントリーサイトの出典(リクナビ / ビズリーチ等)
  entry_site: z.string().max(100).optional().or(z.literal("")),
});

export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
