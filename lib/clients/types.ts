/**
 * クライアントレコード(企業所有)の型定義
 *
 * ハイブリッド設計:
 *   - 企業が管理する「クライアント情報」は求職者本人のMyairaアカウントとは別物
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

// ────────────────────────────────────────────
// EMPRO 準拠の名簿拡張用 enum + Labels(マイグレーション 20260615100001)
// ────────────────────────────────────────────

export type ClientGender = "male" | "female" | "other" | "prefer_not_to_say";
export const clientGenderLabels: Record<ClientGender, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  prefer_not_to_say: "回答しない",
};

export type ClientMaritalStatus = "single" | "married" | "prefer_not_to_say";
export const clientMaritalStatusLabels: Record<ClientMaritalStatus, string> = {
  single: "未婚",
  married: "既婚",
  prefer_not_to_say: "回答しない",
};

export type ClientEmploymentType =
  | "full_time"
  | "contract"
  | "temporary"
  | "part_time"
  | "business_outsource"
  | "self_employed"
  | "unemployed"
  | "student"
  | "other";
export const clientEmploymentTypeLabels: Record<ClientEmploymentType, string> = {
  full_time: "正社員",
  contract: "契約社員",
  temporary: "派遣社員",
  part_time: "アルバイト・パート",
  business_outsource: "業務委託",
  self_employed: "自営業・フリーランス",
  unemployed: "離職中",
  student: "学生",
  other: "その他",
};

export type ClientFinalEducation =
  | "high_school"
  | "vocational"
  | "junior_college"
  | "university"
  | "graduate"
  | "doctorate"
  | "other";
export const clientFinalEducationLabels: Record<ClientFinalEducation, string> = {
  high_school: "高卒",
  vocational: "専門学校卒",
  junior_college: "短大卒",
  university: "大学卒",
  graduate: "大学院修了(修士)",
  doctorate: "大学院修了(博士)",
  other: "その他",
};

export type ClientJobChangeTiming =
  | "immediate"
  | "within_3months"
  | "within_6months"
  | "within_1year"
  | "undecided";
export const clientJobChangeTimingLabels: Record<ClientJobChangeTiming, string> = {
  immediate: "すぐにでも",
  within_3months: "3ヶ月以内",
  within_6months: "半年以内",
  within_1year: "1年以内",
  undecided: "未定",
};

export type ClientRecord = {
  id: string;
  organizationId: string;
  assignedMemberId: string | null;
  name: string;
  email: string | null;
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

  // ────────────────────────────────────────────
  // EMPRO 準拠の名簿拡張(マイグレーション 20260615100001)
  // ────────────────────────────────────────────
  // 基本属性(平文)
  nameKana: string | null;
  birthDate: string | null; // YYYY-MM-DD
  gender: ClientGender | null;
  nationality: string | null;
  maritalStatus: ClientMaritalStatus | null;
  // 住所(都道府県・郵便番号までは平文。詳細は city/street/building、平文だが
  // 一覧では非表示の方針。CLAUDE.md 暗号化対象リストには明示載っていないため
  // 既存 phone と同等の平文扱い)
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  street: string | null;
  building: string | null;
  // 副連絡先(平文、既存 phone / email と同等)
  phone2: string | null;
  email2: string | null;
  // 現職情報(集計可能な enum / 数値 / タグ配列は平文)
  currentEmploymentType: ClientEmploymentType | null;
  currentAnnualIncome: number | null; // 万円
  finalEducation: ClientFinalEducation | null;
  experienceIndustries: string[]; // 経験業種(タグ、空配列で「未入力」)
  experienceOccupations: string[]; // 経験職種(タグ)
  // 希望条件(マッチング絞り込みのため平文)
  desiredIndustries: string[];
  desiredOccupations: string[];
  desiredLocations: string[];
  desiredAnnualIncome: number | null; // 万円
  jobChangeTiming: ClientJobChangeTiming | null;
  // 運用キー日付(集計の起点として平文)
  intakeDate: string | null; // YYYY-MM-DD
  firstMeetingDate: string | null; // YYYY-MM-DD

  // CRM 運用フラグ用の自由タグ(VIP / 要フォロー / 上場志望 等)。
  // 空配列がデフォルト。NULL は来ない契約(DB default '{}'::text[])。
  // experience_industries / desired_industries とは別物(あちらは業務軸の構造化タグ)。
  crmTags: string[];

  // カスタムフィールド値(20260615210001)。空オブジェクトがデフォルト。
  // キーは client_custom_field_definitions.key と対応。値は型ごとに異なる(JSON)。
  customFields: Record<string, unknown>;

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
  // EMPRO 拡張の暗号化対象(自由記述で個人特定リスクが高い項目 / 内部メモ系)
  educationDetail: string | null; // 学歴詳細
  skills: string | null; // 保有資格・スキル
  jobChangeReason: string | null; // 転職理由
  desiredConditions: string | null; // 希望条件詳細
  meetingNotes: string | null; // 面談所感(内部メモ)
  statusMemo: string | null; // ステータスメモ(内部メモ)
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
  // 沈黙顧客アラート(CRM 機能):
  //   最後に客先と対応があった日時(client_interactions.occurred_at の最大値)。
  //   null = 一度も対応履歴が無い(新規受付したがまだ動けていない顧客)。
  //   「N 日以上対応なし」の判定は createdAt を fallback にして lib/clients/filter-sort.ts で行う。
  lastInteractionAt: string | null;
  // 次の Web 面談予約(meeting_schedules.starts_at の最小値、status='scheduled' のみ)。
  // null = 予約なし。
  nextMeetingAt: string | null;
};

// ────────────────────────────────────────────
// zod 共通ピース(EMPRO 拡張で使い回す enum / 数値範囲)
// ────────────────────────────────────────────

const genderEnum = z.enum(["male", "female", "other", "prefer_not_to_say"]);
const maritalStatusEnum = z.enum(["single", "married", "prefer_not_to_say"]);
const employmentTypeEnum = z.enum([
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
const finalEducationEnum = z.enum([
  "high_school",
  "vocational",
  "junior_college",
  "university",
  "graduate",
  "doctorate",
  "other",
]);
const jobChangeTimingEnum = z.enum([
  "immediate",
  "within_3months",
  "within_6months",
  "within_1year",
  "undecided",
]);

// 年収の preprocessor:<input type="number"> の空文字を null に正規化。
// 0〜10 万円(万円単位)を超えると DB 制約に当たるため zod でも上限ガード。
const annualIncomeField = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return null;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isNaN(n) ? val : n;
  }
  return val;
}, z.number().int().min(0).max(100000).nullable());

// 日付フィールド:YYYY-MM-DD or 空文字 or null を許容。
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional()
  .or(z.literal(""));

// タグ配列:string[](各要素 1〜100 文字、配列は最大 20 件)。
// 空配列を「未入力」として扱う。null/undefined は空配列に正規化。
const tagArrayField = z.preprocess(
  (val) => (val === null || val === undefined ? [] : val),
  z.array(z.string().min(1).max(100)).max(20),
);

// クライアント登録リクエスト
// email は任意入力。LINE 由来の顧客や、メールアドレスをまだ聞けていない顧客も
// 登録できるように optional にしている(client_records.email は DB でも nullable)。
// 入力する場合はメール形式の検証はかける。空文字も許容(UI から未入力で送るケース)。
export const createClientRequestSchema = z.object({
  name: z.string().min(1, "氏名を入力してください").max(100),
  email: z.string().email("正しいメールアドレスを入力してください").optional().or(z.literal("")),
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

  // EMPRO 拡張のうち、登録時から入れたい最低限の項目だけ受ける。
  // name_kana・受付年月日は集計の起点になりやすいので登録時推奨。
  // 残りの拡張(現職・希望条件・面談)は新規登録時は無入力で、編集画面で埋める運用。
  name_kana: z.string().max(100).optional().or(z.literal("")),
  intake_date: dateField,
});

export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;

// クライアント更新リクエスト
export const updateClientRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // 空文字も受ける(UI から「メール未入力に戻す」ケース → サーバ側で null に倒す)。
  email: z.string().email().optional().or(z.literal("")),
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

  // ────────────────────────────────────────────
  // EMPRO 準拠の名簿拡張(平文。マイグレーション 20260615100001)
  // ────────────────────────────────────────────
  // 基本属性
  name_kana: z.string().max(100).optional().or(z.literal("")),
  birth_date: dateField,
  gender: genderEnum.nullable().optional().or(z.literal("")),
  nationality: z.string().max(100).optional().or(z.literal("")),
  marital_status: maritalStatusEnum.nullable().optional().or(z.literal("")),
  // 住所
  postal_code: z.string().max(10).optional().or(z.literal("")),
  prefecture: z.string().max(20).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  street: z.string().max(200).optional().or(z.literal("")),
  building: z.string().max(200).optional().or(z.literal("")),
  // 副連絡先
  phone2: z.string().max(20).optional().or(z.literal("")),
  email2: z.string().email().optional().or(z.literal("")),
  // 現職情報
  current_employment_type: employmentTypeEnum.nullable().optional().or(z.literal("")),
  current_annual_income: annualIncomeField.optional(),
  final_education: finalEducationEnum.nullable().optional().or(z.literal("")),
  experience_industries: tagArrayField.optional(),
  experience_occupations: tagArrayField.optional(),
  // 希望条件
  desired_industries: tagArrayField.optional(),
  desired_occupations: tagArrayField.optional(),
  desired_locations: tagArrayField.optional(),
  desired_annual_income: annualIncomeField.optional(),
  job_change_timing: jobChangeTimingEnum.nullable().optional().or(z.literal("")),
  // 運用キー日付
  intake_date: dateField,
  first_meeting_date: dateField,
  // CRM 自由タグ(20260615140001 マイグレーション)
  // 空配列で「クリア」(API ルートで [] → null は無く、そのまま [] を保存)。
  crm_tags: tagArrayField.optional(),

  // ────────────────────────────────────────────
  // EMPRO 準拠の暗号化対象(自由記述、API ルートで encryptField)
  // ────────────────────────────────────────────
  education_detail: z.string().max(2000).optional().or(z.literal("")),
  skills: z.string().max(5000).optional().or(z.literal("")),
  job_change_reason: z.string().max(2000).optional().or(z.literal("")),
  desired_conditions: z.string().max(5000).optional().or(z.literal("")),
  meeting_notes: z.string().max(5000).optional().or(z.literal("")),
  status_memo: z.string().max(2000).optional().or(z.literal("")),
});

export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
