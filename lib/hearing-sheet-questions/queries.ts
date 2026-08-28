/**
 * ヒアリングシートの質問定義 / タイトル設定のクエリヘルパー。
 *
 * ・定義(hearing_sheet_question_definitions)は平文(テンプレートであり非機密)。
 * ・RLS で SELECT=メンバー / 追加更新削除=admin を保証。ここでも organization_id で
 *   明示フィルタして二重防御する。
 * ・回答本体(hearing_sheets.encrypted_content)の暗号化境界はここには無い
 *   (lib/agency-client-documents/queries.ts が担当)。
 */
import { createClient } from "@/lib/supabase/server";

import {
  DEFAULT_HEARING_SHEET_TITLE,
  type CreateHearingQuestionInput,
  type HearingQuestionDefinition,
  type HearingQuestionRow,
  rowToHearingQuestion,
  STANDARD_HEARING_QUESTIONS,
  type UpdateHearingQuestionInput,
} from "./types";

/** DB が空(未 materialize)のときに合成して返す標準定義。 */
function synthesizeStandardDefinitions(organizationId: string): HearingQuestionDefinition[] {
  return STANDARD_HEARING_QUESTIONS.map((q) => ({
    id: `default:${q.key}`,
    organizationId,
    key: q.key,
    label: q.label,
    helpText: null,
    inputType: q.inputType,
    maxLength: q.maxLength,
    mapsToPii: null,
    displayOrder: q.displayOrder,
    createdAt: "",
    updatedAt: "",
  }));
}

/**
 * 組織の質問定義(実在行のみ)を display_order 昇順で取得。
 * 管理画面(編集 / 削除は実 id が必要)や CRUD の基点で使う。0 件なら空配列。
 */
export async function listHearingSheetQuestions(
  organizationId: string,
): Promise<HearingQuestionDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hearing_sheet_question_definitions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return (data as HearingQuestionRow[]).map(rowToHearingQuestion);
}

/**
 * ヒアリングシートの描画 / 本人情報流し込み用。
 * 実在行が 0 件のときだけ標準 11 項目を合成して返す(シートが空にならないよう二重防御)。
 * 合成行の id は "default:*" で実在しないので、編集 / 削除の対象にはしないこと。
 */
export async function listHearingSheetQuestionsForSheet(
  organizationId: string,
): Promise<HearingQuestionDefinition[]> {
  const rows = await listHearingSheetQuestions(organizationId);
  return rows.length > 0 ? rows : synthesizeStandardDefinitions(organizationId);
}

/** 組織のヒアリングシートタイトル(行が無ければ既定)。 */
export async function getHearingSheetTitle(organizationId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_hearing_sheet_settings")
    .select("title")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return DEFAULT_HEARING_SHEET_TITLE;
  const title = (data as { title: string }).title;
  return title.trim().length > 0 ? title : DEFAULT_HEARING_SHEET_TITLE;
}

/** タイトルを設定(upsert)。admin のみ(RLS)。 */
export async function setHearingSheetTitle(
  organizationId: string,
  title: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_hearing_sheet_settings")
    .upsert({ organization_id: organizationId, title }, { onConflict: "organization_id" });

  if (error) return { error: error.message };
  return { ok: true };
}

/** 質問を 1 件追加。admin のみ(RLS)。key 重複は 23505。 */
export async function createHearingSheetQuestion(
  organizationId: string,
  input: CreateHearingQuestionInput,
): Promise<HearingQuestionDefinition | { error: string; code?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hearing_sheet_question_definitions")
    .insert({
      organization_id: organizationId,
      key: input.key,
      label: input.label,
      help_text: input.help_text ?? null,
      input_type: input.input_type,
      max_length: input.max_length,
      maps_to_pii: input.maps_to_pii ?? null,
      display_order: input.display_order,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to create question", code: error?.code };
  }
  return rowToHearingQuestion(data as HearingQuestionRow);
}

/** 質問を更新(key 以外)。admin のみ(RLS)。organization_id でも明示フィルタ。 */
export async function updateHearingSheetQuestion(
  id: string,
  organizationId: string,
  input: UpdateHearingQuestionInput,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();

  // 送られてきた項目だけを snake_case に詰め替える(未指定は触らない)。
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.help_text !== undefined) patch.help_text = input.help_text;
  if (input.input_type !== undefined) patch.input_type = input.input_type;
  if (input.max_length !== undefined) patch.max_length = input.max_length;
  if (input.maps_to_pii !== undefined) patch.maps_to_pii = input.maps_to_pii;
  if (input.display_order !== undefined) patch.display_order = input.display_order;

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("hearing_sheet_question_definitions")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) return { error: error.message };
  return { ok: true };
}

/** 質問を削除。admin のみ(RLS)。既存回答(暗号化 JSON)側の該当キーは残る(無害)。 */
export async function deleteHearingSheetQuestion(
  id: string,
  organizationId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("hearing_sheet_question_definitions")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) return { error: error.message };
  return { ok: true };
}
