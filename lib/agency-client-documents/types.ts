/**
 * エージェント所有のクライアント書類(履歴書 / 職務経歴書 / 写真 /
 * ヒアリングシート / 代行応募)の型定義と zod スキーマ。
 *
 * 既存の lib/resumes/types や lib/recommendation-letters/types と同じ作法:
 *   ・DB 行型(*Row) は snake_case のまま
 *   ・アプリ内型は camelCase に変換
 *   ・暗号化フィールドは復号後の平文型を持つ
 */
import { z } from "zod";

// ───────────────────────────────────────────────────────────────────
// 1. agency_client_resumes
// ───────────────────────────────────────────────────────────────────
export type AgencyClientResumeStatus = "draft" | "final";

export type AgencyClientResumeRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  title: string;
  document_date: string | null;
  encrypted_pii: string;
  education_history: unknown;
  licenses: unknown;
  photo_storage_path: string | null;
  status: AgencyClientResumeStatus;
  source_recording_id: string | null;
  source_hearing_sheet_id: string | null;
  pushed_to_draft_id: string | null;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 履歴書本体に保持する PII(暗号化後の JSON)。
 * 平文プロパティに分解しているが、保存時は JSON.stringify して 1 つの
 * encrypted_pii カラムに収める方針(列追加の度に migration を打ちたくない)。
 */
export const resumePiiSchema = z.object({
  full_name: z.string().max(100).default(""),
  full_name_kana: z.string().max(100).default(""),
  birth_date: z.string().max(10).default(""), // YYYY-MM-DD or ""
  gender: z.enum(["male", "female", "other", ""]).default(""),
  postal_code: z.string().max(10).default(""),
  address: z.string().max(300).default(""),
  phone: z.string().max(20).default(""),
  email: z.string().max(254).default(""),
  motivation: z.string().max(2000).default(""),
  self_pr: z.string().max(2000).default(""),
  // 履歴書様式の「本人希望記入欄」
  preferences: z.string().max(1000).default(""),
});
export type ResumePii = z.infer<typeof resumePiiSchema>;

export const educationItemSchema = z.object({
  year: z.string().max(7).default(""), // YYYY or YYYY/MM
  description: z.string().max(200).default(""),
});
export const licenseItemSchema = z.object({
  year: z.string().max(7).default(""),
  description: z.string().max(200).default(""),
});
export type EducationItem = z.infer<typeof educationItemSchema>;
export type LicenseItem = z.infer<typeof licenseItemSchema>;

export type AgencyClientResume = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  title: string;
  documentDate: string | null;
  pii: ResumePii;
  educationHistory: EducationItem[];
  licenses: LicenseItem[];
  photoStoragePath: string | null;
  status: AgencyClientResumeStatus;
  sourceRecordingId: string | null;
  sourceHearingSheetId: string | null;
  pushedToDraftId: string | null;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const createAgencyClientResumeRequestSchema = z.object({
  client_record_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  document_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  pii: resumePiiSchema.optional(),
  education_history: z.array(educationItemSchema).max(50).optional(),
  licenses: z.array(licenseItemSchema).max(50).optional(),
});

export const updateAgencyClientResumeRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  document_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  pii: resumePiiSchema.optional(),
  education_history: z.array(educationItemSchema).max(50).optional(),
  licenses: z.array(licenseItemSchema).max(50).optional(),
  status: z.enum(["draft", "final"]).optional(),
  photo_storage_path: z.string().max(500).nullable().optional(),
});

// ───────────────────────────────────────────────────────────────────
// 2. agency_client_cvs
// ───────────────────────────────────────────────────────────────────
export type AgencyClientCvStatus = "draft" | "final";

export type AgencyClientCvRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  title: string;
  document_date: string | null;
  encrypted_body: string;
  related_resume_id: string | null;
  status: AgencyClientCvStatus;
  source_recording_id: string | null;
  source_hearing_sheet_id: string | null;
  pushed_to_draft_id: string | null;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 職務経歴書本体(暗号化後 JSON)。
 * 自由記述の長文 body + 構造化サマリ summary を持つ。summary は AI 抽出
 * 結果のプリフィルや、PDF 出力時のセクション分けに使う。
 */
export const cvBodySchema = z.object({
  summary: z.string().max(2000).default(""),
  body: z.string().max(20000).default(""),
});
export type CvBody = z.infer<typeof cvBodySchema>;

export type AgencyClientCv = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  title: string;
  documentDate: string | null;
  body: CvBody;
  relatedResumeId: string | null;
  status: AgencyClientCvStatus;
  sourceRecordingId: string | null;
  sourceHearingSheetId: string | null;
  pushedToDraftId: string | null;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const createAgencyClientCvRequestSchema = z.object({
  client_record_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  document_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  body: cvBodySchema.optional(),
  related_resume_id: z.string().uuid().optional(),
});

export const updateAgencyClientCvRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  document_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  body: cvBodySchema.optional(),
  related_resume_id: z.string().uuid().nullable().optional(),
  status: z.enum(["draft", "final"]).optional(),
});

// ───────────────────────────────────────────────────────────────────
// 3. agency_client_photos
// ───────────────────────────────────────────────────────────────────
export type AgencyClientPhotoRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  storage_path: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  uploaded_by_member_id: string | null;
  created_at: string;
};

export type AgencyClientPhoto = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  storagePath: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  uploadedByMemberId: string | null;
  createdAt: string;
};

// ───────────────────────────────────────────────────────────────────
// 4. hearing_sheets
// ───────────────────────────────────────────────────────────────────
export type HearingSheetStatus = "draft" | "finalized";

export type HearingSheetRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  meeting_schedule_id: string | null;
  encrypted_content: string;
  source_recording_id: string | null;
  ai_extracted_at: string | null;
  human_reviewed_at: string | null;
  status: HearingSheetStatus;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * ヒアリングシートの構造化項目。
 * AI 抽出と人手修正の整合を取りやすいよう、設問単位で持つ。
 */
export const hearingSheetContentSchema = z.object({
  current_job: z.string().max(2000).default(""),
  strengths: z.string().max(2000).default(""),
  weaknesses: z.string().max(2000).default(""),
  desired_industry: z.string().max(500).default(""),
  desired_position: z.string().max(500).default(""),
  desired_location: z.string().max(500).default(""),
  desired_salary: z.string().max(200).default(""),
  job_change_reason: z.string().max(2000).default(""),
  motivation: z.string().max(2000).default(""),
  availability: z.string().max(500).default(""),
  notes: z.string().max(4000).default(""),
});
export type HearingSheetContent = z.infer<typeof hearingSheetContentSchema>;

export type HearingSheet = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  meetingScheduleId: string | null;
  content: HearingSheetContent;
  sourceRecordingId: string | null;
  aiExtractedAt: string | null;
  humanReviewedAt: string | null;
  status: HearingSheetStatus;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const createHearingSheetRequestSchema = z.object({
  client_record_id: z.string().uuid(),
  meeting_schedule_id: z.string().uuid().optional(),
  content: hearingSheetContentSchema.optional(),
});

export const updateHearingSheetRequestSchema = z.object({
  content: hearingSheetContentSchema.optional(),
  status: z.enum(["draft", "finalized"]).optional(),
  human_reviewed_at: z.string().datetime().nullable().optional(),
});

// ───────────────────────────────────────────────────────────────────
// 5. agency_applications
// ───────────────────────────────────────────────────────────────────
export type AgencyApplicationStatus =
  | "submitted"
  | "screening"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export const AGENCY_APPLICATION_STATUS_LABEL: Record<AgencyApplicationStatus, string> = {
  submitted: "応募済み",
  screening: "書類選考中",
  interview: "面接中",
  offer: "内定",
  rejected: "見送り",
  withdrawn: "辞退",
};

export type AgencyApplicationRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  referral_id: string;
  encrypted_details: string;
  status: AgencyApplicationStatus;
  applied_at: string;
  applied_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

export const agencyApplicationDetailsSchema = z.object({
  applied_via: z.string().max(200).default(""),
  contact_name: z.string().max(100).default(""),
  status_memo: z.string().max(4000).default(""),
  next_action_at: z.string().max(30).default(""), // ISO 文字列 or 空
});
export type AgencyApplicationDetails = z.infer<typeof agencyApplicationDetailsSchema>;

export type AgencyApplication = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  referralId: string;
  details: AgencyApplicationDetails;
  status: AgencyApplicationStatus;
  appliedAt: string;
  appliedByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const createAgencyApplicationRequestSchema = z.object({
  client_record_id: z.string().uuid(),
  referral_id: z.string().uuid(),
  details: agencyApplicationDetailsSchema.optional(),
  status: z
    .enum(["submitted", "screening", "interview", "offer", "rejected", "withdrawn"])
    .optional(),
  applied_at: z.string().datetime().optional(),
});

export const updateAgencyApplicationRequestSchema = z.object({
  details: agencyApplicationDetailsSchema.optional(),
  status: z
    .enum(["submitted", "screening", "interview", "offer", "rejected", "withdrawn"])
    .optional(),
  applied_at: z.string().datetime().optional(),
});
