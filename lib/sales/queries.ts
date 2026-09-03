/**
 * 運営 営業パイプラインのクエリヘルパー。
 *
 * すべて service_role(createServiceClient)で読み書きする。呼び出し側の API ルートで
 * 必ず isMairaAdmin() を通してから使うこと(本ファイルは admin 判定をしない)。
 * 機密テキスト(トランスクリプト / 議事録 / アドバイス)の暗号化境界を本ファイルに閉じ込める。
 */
import { decryptFieldSafe, encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

import type {
  CreateProspectInput,
  SalesMeeting,
  SalesMeetingRow,
  SalesMeetingSource,
  SalesMeetingStatus,
  SalesProspect,
  SalesProspectRow,
  SalesStage,
  UpdateProspectInput,
} from "./types";

// ── prospects ──────────────────────────────────────────────────────
function rowToProspect(r: SalesProspectRow): SalesProspect {
  return {
    id: r.id,
    companyName: r.company_name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    stage: r.stage,
    ownerUserId: r.owner_user_id,
    notes: r.notes,
    aiPlaybook: r.ai_playbook,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listProspects(): Promise<SalesProspect[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("sales_prospects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as SalesProspectRow[]).map(rowToProspect);
}

export async function getProspect(id: string): Promise<SalesProspect | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("sales_prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProspect(data as SalesProspectRow);
}

export async function createProspect(
  input: CreateProspectInput,
  ownerUserId: string,
): Promise<SalesProspect | { error: string }> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("sales_prospects")
    .insert({
      company_name: input.company_name.trim(),
      contact_name: input.contact_name ?? null,
      contact_email: input.contact_email ? input.contact_email : null,
      stage: input.stage ?? "lead",
      owner_user_id: ownerUserId,
      notes: input.notes ?? null,
      ai_playbook: input.ai_playbook ?? null,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "作成に失敗しました" };
  return rowToProspect(data as SalesProspectRow);
}

export async function updateProspect(
  id: string,
  input: UpdateProspectInput,
): Promise<{ ok: true } | { error: string }> {
  const patch: Record<string, unknown> = {};
  if (input.company_name !== undefined) patch.company_name = input.company_name.trim();
  if (input.contact_name !== undefined) patch.contact_name = input.contact_name;
  if (input.contact_email !== undefined)
    patch.contact_email = input.contact_email ? input.contact_email : null;
  if (input.stage !== undefined) patch.stage = input.stage;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.ai_playbook !== undefined) patch.ai_playbook = input.ai_playbook;
  if (Object.keys(patch).length === 0) return { ok: true };

  const service = createServiceClient();
  const { data, error } = await service
    .from("sales_prospects")
    .update(patch)
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "not_found" };
  return { ok: true };
}

export async function deleteProspect(id: string): Promise<{ ok: true } | { error: string }> {
  const service = createServiceClient();
  const { error } = await service.from("sales_prospects").delete().eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ── meetings ───────────────────────────────────────────────────────
async function rowToMeeting(r: SalesMeetingRow): Promise<SalesMeeting> {
  const [transcript, minutes, advice] = await Promise.all([
    decryptFieldSafe(r.encrypted_transcript),
    decryptFieldSafe(r.encrypted_minutes),
    decryptFieldSafe(r.encrypted_advice),
  ]);
  return {
    id: r.id,
    prospectId: r.prospect_id,
    meetingNo: r.meeting_no,
    stage: r.stage,
    title: r.title,
    meetingDate: r.meeting_date,
    source: r.source,
    storagePath: r.storage_path,
    originalFilename: r.original_filename,
    sizeBytes: r.size_bytes,
    durationSeconds: r.duration_seconds,
    status: r.status,
    statusMessage: r.status_message,
    transcript: transcript ?? "",
    minutes: minutes ?? "",
    advice: advice ?? "",
    model: r.model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listMeetings(prospectId: string): Promise<SalesMeeting[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("sales_meetings")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("meeting_no", { ascending: false })
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return Promise.all((data as SalesMeetingRow[]).map(rowToMeeting));
}

export async function getMeeting(id: string): Promise<SalesMeeting | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("sales_meetings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToMeeting(data as SalesMeetingRow);
}

/** 次のミーティング番号(既存の最大 + 1)。 */
export async function nextMeetingNo(prospectId: string): Promise<number> {
  const service = createServiceClient();
  const { data } = await service
    .from("sales_meetings")
    .select("meeting_no")
    .eq("prospect_id", prospectId)
    .order("meeting_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const max = (data as { meeting_no: number } | null)?.meeting_no ?? 0;
  return max + 1;
}

export type InsertMeetingParams = {
  /** 事前に採番する場合の id(音声パスを id 基準にするため)。未指定なら DB 側で採番。 */
  id?: string;
  prospectId: string;
  meetingNo: number;
  stage?: SalesStage | null;
  title?: string | null;
  meetingDate?: string | null;
  source: SalesMeetingSource;
  storagePath?: string | null;
  originalFilename?: string | null;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  status?: SalesMeetingStatus;
};

/** ミーティング行を作成(初期状態 processing)。 */
export async function insertMeeting(
  params: InsertMeetingParams,
): Promise<{ id: string } | { error: string }> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("sales_meetings")
    .insert({
      ...(params.id ? { id: params.id } : {}),
      prospect_id: params.prospectId,
      meeting_no: params.meetingNo,
      stage: params.stage ?? null,
      title: params.title ?? null,
      meeting_date: params.meetingDate ?? null,
      source: params.source,
      storage_path: params.storagePath ?? null,
      original_filename: params.originalFilename ?? null,
      size_bytes: params.sizeBytes ?? null,
      duration_seconds: params.durationSeconds ?? null,
      status: params.status ?? "processing",
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "作成に失敗しました" };
  return { id: (data as { id: string }).id };
}

/** 文字起こし + 議事録の結果を保存(暗号化)。status も更新。 */
export async function saveMeetingResult(
  id: string,
  args: {
    transcript?: string | null;
    minutes?: string | null;
    model?: string | null;
    status: SalesMeetingStatus;
    statusMessage?: string | null;
  },
): Promise<{ ok: true } | { error: string }> {
  const service = createServiceClient();
  const patch: Record<string, unknown> = { status: args.status };
  if (args.statusMessage !== undefined) patch.status_message = args.statusMessage;
  if (args.model !== undefined) patch.model = args.model;
  if (args.transcript !== undefined)
    patch.encrypted_transcript = args.transcript ? await encryptField(args.transcript) : null;
  if (args.minutes !== undefined)
    patch.encrypted_minutes = args.minutes ? await encryptField(args.minutes) : null;

  const { error } = await service.from("sales_meetings").update(patch).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

/** AI 次アクション提案を保存(暗号化)。 */
export async function saveMeetingAdvice(
  id: string,
  advice: string,
  model: string | null,
): Promise<{ ok: true } | { error: string }> {
  const service = createServiceClient();
  const { error } = await service
    .from("sales_meetings")
    .update({ encrypted_advice: advice ? await encryptField(advice) : null, model })
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteMeeting(id: string): Promise<{ ok: true } | { error: string }> {
  const service = createServiceClient();
  const { error } = await service.from("sales_meetings").delete().eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}
