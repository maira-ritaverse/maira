/**
 * 面接対策(interview_preps)のクエリヘルパー。
 *
 * 暗号化境界を本ファイルに閉じ込める(API ルート / 画面側は平文の
 * InterviewPrepContent だけを扱う)。recommendation-letters/queries.ts と同じ作法で、
 * RLS に加えて organization_id でも明示的にフィルタする(二重防御)。
 */

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";

import type { InterviewPrep, InterviewPrepContent, InterviewPrepRow } from "./types";

/**
 * 暗号化された JSON を安全にパースする。
 * 壊れた JSON や旧フォーマットでも落ちないよう、空セクションにフォールバックする。
 */
function parseContent(json: string): InterviewPrepContent {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { sections?: unknown }).sections)
    ) {
      const sections = (parsed as { sections: unknown[] }).sections
        .filter(
          (s): s is { heading: unknown; items: unknown } =>
            !!s && typeof s === "object" && "heading" in s && "items" in s,
        )
        .map((s) => ({
          heading: typeof s.heading === "string" ? s.heading : "",
          items: Array.isArray(s.items)
            ? s.items.filter((i): i is string => typeof i === "string")
            : [],
        }))
        .filter((s) => s.heading.length > 0 || s.items.length > 0);
      return { sections };
    }
  } catch {
    // フォールバック(下記)
  }
  return { sections: [] };
}

async function decryptRow(row: InterviewPrepRow): Promise<InterviewPrep> {
  const json = await decryptField(row.encrypted_content);
  return {
    id: row.id,
    organizationId: row.organization_id,
    referralId: row.referral_id,
    content: parseContent(json),
    model: row.model,
    generatedByMemberId: row.generated_by_member_id,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

/** referral に紐づく面接対策を 1 件取得(復号)。無ければ null。 */
export async function getInterviewPrepByReferral(
  referralId: string,
  organizationId: string,
): Promise<InterviewPrep | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interview_preps")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("referral_id", referralId)
    .maybeSingle();

  if (error || !data) return null;
  return decryptRow(data as InterviewPrepRow);
}

export type UpsertInterviewPrepParams = {
  referralId: string;
  organizationId: string;
  memberId: string | null;
  content: InterviewPrepContent;
  model: string | null;
};

/**
 * 面接対策を作成 or 更新(referral_id 一意なので upsert)。
 * 再生成時は generated_at / 内容を最新で上書きする。
 */
export async function upsertInterviewPrep(
  params: UpsertInterviewPrepParams,
): Promise<InterviewPrep | { error: string }> {
  const supabase = await createClient();

  const encrypted = await encryptField(JSON.stringify(params.content));
  // encrypted_content は NOT NULL。空になることは無いが念のため空文字で保証。
  const safeContent = encrypted ?? "";

  const { data, error } = await supabase
    .from("interview_preps")
    .upsert(
      {
        organization_id: params.organizationId,
        referral_id: params.referralId,
        encrypted_content: safeContent,
        model: params.model,
        generated_by_member_id: params.memberId,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "referral_id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to save interview prep" };
  }
  return decryptRow(data as InterviewPrepRow);
}
