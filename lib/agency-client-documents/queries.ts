/**
 * エージェント所有のクライアント書類クエリ集約。
 *
 * 暗号化境界をここに閉じ込め、API ルート / UI 層は平文だけを扱う。
 * RLS が二重防御として効くため、ここでも明示的に organization_id で
 * フィルタする(referrals/queries と同じ作法)。
 */
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";

import {
  type AgencyClientResume,
  type AgencyClientResumeRow,
  type AgencyClientResumeStatus,
  type AgencyClientCv,
  type AgencyClientCvRow,
  type AgencyClientCvStatus,
  type AgencyClientPhoto,
  type AgencyClientPhotoRow,
  type CvBody,
  type EducationItem,
  type HearingSheet,
  type HearingSheetContent,
  type HearingSheetRow,
  type HearingSheetStatus,
  type LicenseItem,
  type ResumePii,
  type AgencyApplication,
  type AgencyApplicationDetails,
  type AgencyApplicationRow,
  type AgencyApplicationStatus,
  cvBodySchema,
  hearingSheetContentSchema,
  resumePiiSchema,
  agencyApplicationDetailsSchema,
} from "./types";

// ───────────────────────────────────────────────────────────────────
// マッパー
// ───────────────────────────────────────────────────────────────────

async function rowToResume(row: AgencyClientResumeRow): Promise<AgencyClientResume> {
  const piiPlain = await decryptField(row.encrypted_pii);
  // 復号 / パース 失敗時は安全側で空 PII を返す(UI で書き直してもらう)
  const pii = parseResumePii(piiPlain);
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    title: row.title,
    documentDate: row.document_date,
    pii,
    educationHistory: ((row.education_history ?? []) as EducationItem[]) ?? [],
    licenses: ((row.licenses ?? []) as LicenseItem[]) ?? [],
    photoStoragePath: row.photo_storage_path,
    status: row.status,
    sourceRecordingId: row.source_recording_id,
    sourceHearingSheetId: row.source_hearing_sheet_id,
    pushedToDraftId: row.pushed_to_draft_id,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseResumePii(raw: string | null): ResumePii {
  if (!raw) return resumePiiSchema.parse({});
  try {
    return resumePiiSchema.parse(JSON.parse(raw));
  } catch {
    return resumePiiSchema.parse({});
  }
}

async function rowToCv(row: AgencyClientCvRow): Promise<AgencyClientCv> {
  const bodyPlain = await decryptField(row.encrypted_body);
  const body = parseCvBody(bodyPlain);
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    title: row.title,
    documentDate: row.document_date,
    body,
    relatedResumeId: row.related_resume_id,
    status: row.status,
    sourceRecordingId: row.source_recording_id,
    sourceHearingSheetId: row.source_hearing_sheet_id,
    pushedToDraftId: row.pushed_to_draft_id,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCvBody(raw: string | null): CvBody {
  if (!raw) return cvBodySchema.parse({});
  try {
    return cvBodySchema.parse(JSON.parse(raw));
  } catch {
    return cvBodySchema.parse({});
  }
}

function rowToPhoto(row: AgencyClientPhotoRow): AgencyClientPhoto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    storagePath: row.storage_path,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    uploadedByMemberId: row.uploaded_by_member_id,
    createdAt: row.created_at,
  };
}

async function rowToHearingSheet(row: HearingSheetRow): Promise<HearingSheet> {
  const contentPlain = await decryptField(row.encrypted_content);
  const content = parseHearingContent(contentPlain);
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    meetingScheduleId: row.meeting_schedule_id,
    content,
    sourceRecordingId: row.source_recording_id,
    aiExtractedAt: row.ai_extracted_at,
    humanReviewedAt: row.human_reviewed_at,
    status: row.status,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseHearingContent(raw: string | null): HearingSheetContent {
  if (!raw) return hearingSheetContentSchema.parse({});
  try {
    return hearingSheetContentSchema.parse(JSON.parse(raw));
  } catch {
    return hearingSheetContentSchema.parse({});
  }
}

async function rowToAgencyApplication(row: AgencyApplicationRow): Promise<AgencyApplication> {
  const detailsPlain = await decryptField(row.encrypted_details);
  const details = parseAgencyApplicationDetails(detailsPlain);
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    referralId: row.referral_id,
    details,
    status: row.status,
    appliedAt: row.applied_at,
    appliedByMemberId: row.applied_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseAgencyApplicationDetails(raw: string | null): AgencyApplicationDetails {
  if (!raw) return agencyApplicationDetailsSchema.parse({});
  try {
    return agencyApplicationDetailsSchema.parse(JSON.parse(raw));
  } catch {
    return agencyApplicationDetailsSchema.parse({});
  }
}

// ───────────────────────────────────────────────────────────────────
// 1. agency_client_resumes
// ───────────────────────────────────────────────────────────────────

export async function listAgencyClientResumes(
  clientRecordId: string,
  organizationId: string,
): Promise<AgencyClientResume[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_client_resumes")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return Promise.all((data as AgencyClientResumeRow[]).map(rowToResume));
}

export async function getAgencyClientResume(
  id: string,
  organizationId: string,
): Promise<AgencyClientResume | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_client_resumes")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToResume(data as AgencyClientResumeRow);
}

export type CreateAgencyClientResumeParams = {
  clientRecordId: string;
  organizationId: string;
  createdByMemberId: string | null;
  title: string;
  documentDate?: string | null;
  pii?: ResumePii;
  educationHistory?: EducationItem[];
  licenses?: LicenseItem[];
};

export async function createAgencyClientResume(
  params: CreateAgencyClientResumeParams,
): Promise<AgencyClientResume | { error: string }> {
  const supabase = await createClient();
  const piiPlain = JSON.stringify(params.pii ?? resumePiiSchema.parse({}));
  const encryptedPii = await encryptField(piiPlain);
  if (!encryptedPii) return { error: "暗号化に失敗しました" };

  const { data, error } = await supabase
    .from("agency_client_resumes")
    .insert({
      organization_id: params.organizationId,
      client_record_id: params.clientRecordId,
      title: params.title,
      document_date: params.documentDate ?? null,
      encrypted_pii: encryptedPii,
      education_history: params.educationHistory ?? [],
      licenses: params.licenses ?? [],
      created_by_member_id: params.createdByMemberId,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "INSERT failed" };
  return rowToResume(data as AgencyClientResumeRow);
}

export type UpdateAgencyClientResumeParams = {
  id: string;
  organizationId: string;
  title?: string;
  documentDate?: string | null;
  pii?: ResumePii;
  educationHistory?: EducationItem[];
  licenses?: LicenseItem[];
  status?: AgencyClientResumeStatus;
  photoStoragePath?: string | null;
};

export async function updateAgencyClientResume(
  params: UpdateAgencyClientResumeParams,
): Promise<AgencyClientResume | { error: string }> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (params.title !== undefined) update.title = params.title;
  if (params.documentDate !== undefined) update.document_date = params.documentDate;
  if (params.educationHistory !== undefined) update.education_history = params.educationHistory;
  if (params.licenses !== undefined) update.licenses = params.licenses;
  if (params.status !== undefined) update.status = params.status;
  if (params.photoStoragePath !== undefined) update.photo_storage_path = params.photoStoragePath;
  if (params.pii !== undefined) {
    const enc = await encryptField(JSON.stringify(params.pii));
    if (!enc) return { error: "暗号化に失敗しました" };
    update.encrypted_pii = enc;
  }
  if (Object.keys(update).length === 0) {
    // 変更なし:現状を返す
    const cur = await getAgencyClientResume(params.id, params.organizationId);
    return cur ?? { error: "Not found" };
  }
  const { data, error } = await supabase
    .from("agency_client_resumes")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", params.organizationId)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "UPDATE failed" };
  return rowToResume(data as AgencyClientResumeRow);
}

export async function deleteAgencyClientResume(
  id: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("agency_client_resumes")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────
// 2. agency_client_cvs
// ───────────────────────────────────────────────────────────────────

export async function listAgencyClientCvs(
  clientRecordId: string,
  organizationId: string,
): Promise<AgencyClientCv[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_client_cvs")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return Promise.all((data as AgencyClientCvRow[]).map(rowToCv));
}

export async function getAgencyClientCv(
  id: string,
  organizationId: string,
): Promise<AgencyClientCv | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_client_cvs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToCv(data as AgencyClientCvRow);
}

export type CreateAgencyClientCvParams = {
  clientRecordId: string;
  organizationId: string;
  createdByMemberId: string | null;
  title: string;
  documentDate?: string | null;
  body?: CvBody;
  relatedResumeId?: string | null;
};

export async function createAgencyClientCv(
  params: CreateAgencyClientCvParams,
): Promise<AgencyClientCv | { error: string }> {
  const supabase = await createClient();
  const bodyPlain = JSON.stringify(params.body ?? cvBodySchema.parse({}));
  const encryptedBody = await encryptField(bodyPlain);
  if (!encryptedBody) return { error: "暗号化に失敗しました" };
  const { data, error } = await supabase
    .from("agency_client_cvs")
    .insert({
      organization_id: params.organizationId,
      client_record_id: params.clientRecordId,
      title: params.title,
      document_date: params.documentDate ?? null,
      encrypted_body: encryptedBody,
      related_resume_id: params.relatedResumeId ?? null,
      created_by_member_id: params.createdByMemberId,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "INSERT failed" };
  return rowToCv(data as AgencyClientCvRow);
}

export type UpdateAgencyClientCvParams = {
  id: string;
  organizationId: string;
  title?: string;
  documentDate?: string | null;
  body?: CvBody;
  relatedResumeId?: string | null;
  status?: AgencyClientCvStatus;
};

export async function updateAgencyClientCv(
  params: UpdateAgencyClientCvParams,
): Promise<AgencyClientCv | { error: string }> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (params.title !== undefined) update.title = params.title;
  if (params.documentDate !== undefined) update.document_date = params.documentDate;
  if (params.relatedResumeId !== undefined) update.related_resume_id = params.relatedResumeId;
  if (params.status !== undefined) update.status = params.status;
  if (params.body !== undefined) {
    const enc = await encryptField(JSON.stringify(params.body));
    if (!enc) return { error: "暗号化に失敗しました" };
    update.encrypted_body = enc;
  }
  if (Object.keys(update).length === 0) {
    const cur = await getAgencyClientCv(params.id, params.organizationId);
    return cur ?? { error: "Not found" };
  }
  const { data, error } = await supabase
    .from("agency_client_cvs")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", params.organizationId)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "UPDATE failed" };
  return rowToCv(data as AgencyClientCvRow);
}

export async function deleteAgencyClientCv(
  id: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("agency_client_cvs")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────
// 3. agency_client_photos
// ───────────────────────────────────────────────────────────────────

export async function listAgencyClientPhotos(
  clientRecordId: string,
  organizationId: string,
): Promise<AgencyClientPhoto[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_client_photos")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as AgencyClientPhotoRow[]).map(rowToPhoto);
}

// ───────────────────────────────────────────────────────────────────
// 4. hearing_sheets
// ───────────────────────────────────────────────────────────────────

export async function listHearingSheets(
  clientRecordId: string,
  organizationId: string,
): Promise<HearingSheet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hearing_sheets")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return Promise.all((data as HearingSheetRow[]).map(rowToHearingSheet));
}

export async function getHearingSheet(
  id: string,
  organizationId: string,
): Promise<HearingSheet | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hearing_sheets")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToHearingSheet(data as HearingSheetRow);
}

export type CreateHearingSheetParams = {
  organizationId: string;
  clientRecordId: string;
  meetingScheduleId?: string | null;
  content?: HearingSheetContent;
  createdByMemberId: string | null;
};

export async function createHearingSheet(
  params: CreateHearingSheetParams,
): Promise<HearingSheet | { error: string }> {
  const supabase = await createClient();
  const contentPlain = JSON.stringify(params.content ?? hearingSheetContentSchema.parse({}));
  const encryptedContent = await encryptField(contentPlain);
  if (!encryptedContent) return { error: "暗号化に失敗しました" };
  const { data, error } = await supabase
    .from("hearing_sheets")
    .insert({
      organization_id: params.organizationId,
      client_record_id: params.clientRecordId,
      meeting_schedule_id: params.meetingScheduleId ?? null,
      encrypted_content: encryptedContent,
      created_by_member_id: params.createdByMemberId,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "INSERT failed" };
  return rowToHearingSheet(data as HearingSheetRow);
}

export type UpdateHearingSheetParams = {
  id: string;
  organizationId: string;
  content?: HearingSheetContent;
  status?: HearingSheetStatus;
  humanReviewedAt?: string | null;
};

export async function updateHearingSheet(
  params: UpdateHearingSheetParams,
): Promise<HearingSheet | { error: string }> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (params.status !== undefined) update.status = params.status;
  if (params.humanReviewedAt !== undefined) update.human_reviewed_at = params.humanReviewedAt;
  if (params.content !== undefined) {
    const enc = await encryptField(JSON.stringify(params.content));
    if (!enc) return { error: "暗号化に失敗しました" };
    update.encrypted_content = enc;
  }
  if (Object.keys(update).length === 0) {
    const cur = await getHearingSheet(params.id, params.organizationId);
    return cur ?? { error: "Not found" };
  }
  const { data, error } = await supabase
    .from("hearing_sheets")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", params.organizationId)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "UPDATE failed" };
  return rowToHearingSheet(data as HearingSheetRow);
}

export async function deleteHearingSheet(
  id: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("hearing_sheets")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────
// 5. agency_applications
// ───────────────────────────────────────────────────────────────────

export async function listAgencyApplications(
  clientRecordId: string,
  organizationId: string,
): Promise<AgencyApplication[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_applications")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return Promise.all((data as AgencyApplicationRow[]).map(rowToAgencyApplication));
}

export async function getAgencyApplicationByReferral(
  referralId: string,
  organizationId: string,
): Promise<AgencyApplication | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_applications")
    .select("*")
    .eq("referral_id", referralId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToAgencyApplication(data as AgencyApplicationRow);
}

export type CreateAgencyApplicationParams = {
  organizationId: string;
  clientRecordId: string;
  referralId: string;
  details?: AgencyApplicationDetails;
  status?: AgencyApplicationStatus;
  appliedAt?: string;
  appliedByMemberId: string | null;
};

export async function createAgencyApplication(
  params: CreateAgencyApplicationParams,
): Promise<AgencyApplication | { error: string }> {
  const supabase = await createClient();
  const detailsPlain = JSON.stringify(params.details ?? agencyApplicationDetailsSchema.parse({}));
  const encryptedDetails = await encryptField(detailsPlain);
  if (!encryptedDetails) return { error: "暗号化に失敗しました" };
  const { data, error } = await supabase
    .from("agency_applications")
    .insert({
      organization_id: params.organizationId,
      client_record_id: params.clientRecordId,
      referral_id: params.referralId,
      encrypted_details: encryptedDetails,
      status: params.status ?? "submitted",
      applied_at: params.appliedAt ?? new Date().toISOString(),
      applied_by_member_id: params.appliedByMemberId,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "INSERT failed" };
  return rowToAgencyApplication(data as AgencyApplicationRow);
}

export type UpdateAgencyApplicationParams = {
  id: string;
  organizationId: string;
  details?: AgencyApplicationDetails;
  status?: AgencyApplicationStatus;
  appliedAt?: string;
};

export async function updateAgencyApplication(
  params: UpdateAgencyApplicationParams,
): Promise<AgencyApplication | { error: string }> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (params.status !== undefined) update.status = params.status;
  if (params.appliedAt !== undefined) update.applied_at = params.appliedAt;
  if (params.details !== undefined) {
    const enc = await encryptField(JSON.stringify(params.details));
    if (!enc) return { error: "暗号化に失敗しました" };
    update.encrypted_details = enc;
  }
  if (Object.keys(update).length === 0) {
    const supabaseRead = await createClient();
    const { data } = await supabaseRead
      .from("agency_applications")
      .select("*")
      .eq("id", params.id)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (!data) return { error: "Not found" };
    return rowToAgencyApplication(data as AgencyApplicationRow);
  }
  const { data, error } = await supabase
    .from("agency_applications")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", params.organizationId)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "UPDATE failed" };
  return rowToAgencyApplication(data as AgencyApplicationRow);
}

export async function deleteAgencyApplication(
  id: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("agency_applications")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
