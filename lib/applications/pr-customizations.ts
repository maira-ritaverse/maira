/**
 * 求人ごとの PR カスタマイズ(application_pr_customizations)取得 / 保存
 *
 * 設計:
 *   - 1 application に対して 0 or 1 件
 *   - 暗号化:overrides JSON を AES-256-GCM で v{n}: 形式に
 *   - 上書き保存(upsert by application_id)
 */
import { z } from "zod";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type { CvBody } from "@/lib/cvs/types";
import type { Resume } from "@/lib/resumes/types";
import { createClient } from "@/lib/supabase/server";

// 応募ごとの差し替え PR の保存形式
//
//   - self_pr        : 履歴書 / 汎用の自己PR(既存フィールド)
//   - cv_self_pr     : 職務経歴書の自己PR(2026-06-15 追加。CV body.self_pr の上限と一致)
//   - motivation_note: 志望動機(既存)
//   - notes          : 自分用メモ(既存)
//
// 古いレコードに cv_self_pr が無くても optional のため後方互換。
export const prOverridesSchema = z.object({
  motivation_note: z.string().max(2000).optional(),
  self_pr: z.string().max(3000).optional(),
  cv_self_pr: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});
export type PrOverrides = z.infer<typeof prOverridesSchema>;

export type ApplicationPrCustomization = {
  applicationId: string;
  baseResumeId: string | null;
  baseCvId: string | null;
  overrides: PrOverrides;
  updatedAt: string;
};

export async function getApplicationPrCustomization(
  applicationId: string,
): Promise<ApplicationPrCustomization | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("application_pr_customizations")
    .select("application_id, base_resume_id, base_cv_id, encrypted_overrides, updated_at")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    application_id: string;
    base_resume_id: string | null;
    base_cv_id: string | null;
    encrypted_overrides: string;
    updated_at: string;
  };
  let overrides: PrOverrides = {};
  try {
    const plain = await decryptField(row.encrypted_overrides);
    if (typeof plain === "string" && plain.length > 0) {
      const parsed = JSON.parse(plain) as unknown;
      const v = prOverridesSchema.safeParse(parsed);
      if (v.success) overrides = v.data;
    }
  } catch {
    // 復号失敗時は空オブジェクト
  }
  return {
    applicationId: row.application_id,
    baseResumeId: row.base_resume_id,
    baseCvId: row.base_cv_id,
    overrides,
    updatedAt: row.updated_at,
  };
}

export type SavePrCustomizationInput = {
  applicationId: string;
  userId: string;
  baseResumeId?: string | null;
  baseCvId?: string | null;
  overrides: PrOverrides;
};

export async function saveApplicationPrCustomization(
  input: SavePrCustomizationInput,
): Promise<void> {
  const supabase = await createClient();
  const encrypted = await encryptField(JSON.stringify(input.overrides));
  if (!encrypted) {
    throw new Error("PR カスタマイズの暗号化に失敗しました");
  }
  const { error } = await supabase.from("application_pr_customizations").upsert(
    {
      application_id: input.applicationId,
      user_id: input.userId,
      base_resume_id: input.baseResumeId ?? null,
      base_cv_id: input.baseCvId ?? null,
      encrypted_overrides: encrypted,
    },
    { onConflict: "application_id" },
  );
  if (error) {
    throw new Error(`save_failed: ${error.message}`);
  }
}

/**
 * 履歴書(Resume)に応募ごとの差分(overrides)を適用する。
 *
 * 厚労省様式の履歴書は専用の「自己PR」欄を持たず、自由記述欄(motivationNote:
 * 「志望の動機、特技、好きな学科、アピールポイント等」)に
 * 志望動機と自己PRをまとめて書く運用が一般的。
 * そのため:
 *   - overrides.motivation_note と overrides.self_pr が両方ある → 改行 2 つで連結
 *   - 片方だけ → そのまま
 *   - 両方空(or 未設定)→ resume 本体の motivationNote を維持
 *
 * 純関数。資格・学歴・職歴などには触らない。
 */
export function applyResumeOverrides(resume: Resume, overrides: PrOverrides): Resume {
  const motivation = overrides.motivation_note?.trim() ?? "";
  const selfPr = overrides.self_pr?.trim() ?? "";
  if (!motivation && !selfPr) return resume;
  const combined = [motivation, selfPr].filter((s) => s.length > 0).join("\n\n");
  return { ...resume, motivationNote: combined };
}

/**
 * 職務経歴書(CvBody)に応募ごとの差分を適用する。
 *
 * 職務経歴書は専用の自己PR欄(body.self_pr)を持つので、
 * overrides.cv_self_pr で直接上書きする。空(未設定 / 空文字)なら本体を維持。
 *
 * 純関数。要約・職歴・スキルには触らない。
 */
export function applyCvOverrides(body: CvBody, overrides: PrOverrides): CvBody {
  const v = overrides.cv_self_pr?.trim();
  if (!v) return body;
  return { ...body, self_pr: v };
}

export async function deleteApplicationPrCustomization(applicationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("application_pr_customizations")
    .delete()
    .eq("application_id", applicationId);
  if (error) {
    throw new Error(`delete_failed: ${error.message}`);
  }
}
