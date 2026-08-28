/**
 * 面接対策(interview_preps)のクエリヘルパー。
 *
 * 暗号化境界を本ファイルに閉じ込める(API ルート / 画面側は平文の
 * InterviewPrepContent だけを扱う)。recommendation-letters/queries.ts と同じ作法で、
 * RLS に加えて organization_id でも明示的にフィルタする(二重防御)。
 */

import { decryptField, decryptFieldSafe, encryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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
    sharedAt: row.shared_at,
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
 *
 * 重要:再生成すると内容が変わるため、shared_at を必ず null に戻す。
 * これで「共有済みだが中身は古い」状態を防ぐ(再度「共有」を押すまで求職者には見えない)。
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
        // 生成/再生成で内容が変わるので共有状態はリセットする(再共有を必須にする)
        shared_at: null,
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

/**
 * 面接対策を求職者へ共有する(shared_at を現在時刻に設定)。
 * まだ生成されていない referral では対象行が無く 0 件更新となるため、その場合は not_found を返す。
 * organization_id でも明示フィルタ(RLS と二重防御)。
 */
export async function shareInterviewPrep(
  referralId: string,
  organizationId: string,
): Promise<InterviewPrep | { error: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("interview_preps")
    .update({ shared_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("referral_id", referralId)
    .select("*")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "not_found" };
  return decryptRow(data as InterviewPrepRow);
}

// ============================================================================
// 求職者本人向け(service_role + 手動認可)
//
// recommendation-letters の求職者ページと同じ作法:RLS ではなく service client を
// 使い、「linked_user_id === userId かつ link_status='linked' かつ shared_at not null」
// を明示的に検証する。RLS ポリシーでも同条件を保証しているが二重防御。
// ============================================================================

/** 求職者一覧に出す 1 件分(本文は載せず見出しのみ)。 */
export type SharedInterviewPrepListItem = {
  referralId: string;
  organizationName: string;
  jobLabel: string;
  sharedAt: string | null;
  /** 内容の先頭見出し(一覧のプレビュー用)。 */
  firstHeading: string;
  sectionCount: number;
};

type SeekerReferralRow = {
  id: string;
  organization_id: string;
  job_postings:
    | { company_name: string; position: string }
    | { company_name: string; position: string }[]
    | null;
};

function jobLabelOf(jp: SeekerReferralRow["job_postings"]): string {
  const posting = Array.isArray(jp) ? jp[0] : jp;
  return posting ? `${posting.company_name} / ${posting.position}` : "求人";
}

/**
 * 求職者本人に共有済みの面談対策一覧(shared_at not null のみ)。
 * 連携済 client_records → referrals → interview_preps を辿る。
 */
export async function listSharedInterviewPrepsForSeeker(
  userId: string,
): Promise<SharedInterviewPrepListItem[]> {
  const service = createServiceClient();

  const { data: clientRows } = await service
    .from("client_records")
    .select("id")
    .eq("linked_user_id", userId)
    .eq("link_status", "linked");
  const clientIds = ((clientRows as { id: string }[] | null) ?? []).map((r) => r.id);
  if (clientIds.length === 0) return [];

  const { data: referralRows } = await service
    .from("referrals")
    .select("id, organization_id, job_postings ( company_name, position )")
    .in("client_record_id", clientIds);
  const referrals = (referralRows as SeekerReferralRow[] | null) ?? [];
  if (referrals.length === 0) return [];
  const referralById = new Map<string, SeekerReferralRow>(referrals.map((r) => [r.id, r]));

  const { data: prepRows } = await service
    .from("interview_preps")
    .select("referral_id, organization_id, encrypted_content, shared_at")
    .in("referral_id", Array.from(referralById.keys()))
    .not("shared_at", "is", null)
    .order("shared_at", { ascending: false });
  const preps =
    (prepRows as
      | {
          referral_id: string;
          organization_id: string;
          encrypted_content: string;
          shared_at: string | null;
        }[]
      | null) ?? [];
  if (preps.length === 0) return [];

  const orgIds = Array.from(new Set(preps.map((p) => p.organization_id)));
  const { data: orgRows } = await service.from("organizations").select("id, name").in("id", orgIds);
  const orgNameById = new Map<string, string>(
    ((orgRows as { id: string; name: string }[] | null) ?? []).map((o) => [o.id, o.name]),
  );

  // 1 件の復号失敗で一覧全体を落とさないよう decryptFieldSafe(失敗は空セクション扱い)
  const decrypted = await Promise.all(preps.map((p) => decryptFieldSafe(p.encrypted_content)));

  return preps.map((p, idx) => {
    const content = decrypted[idx] ? parseContent(decrypted[idx] as string) : { sections: [] };
    const referral = referralById.get(p.referral_id);
    return {
      referralId: p.referral_id,
      organizationName: orgNameById.get(p.organization_id) ?? "エージェント",
      jobLabel: referral ? jobLabelOf(referral.job_postings) : "求人",
      sharedAt: p.shared_at,
      firstHeading: content.sections[0]?.heading ?? "",
      sectionCount: content.sections.length,
    };
  });
}

/** 求職者向けの詳細(本文込み)。 */
export type SharedInterviewPrepDetail = {
  referralId: string;
  organizationName: string;
  jobLabel: string;
  sharedAt: string | null;
  content: InterviewPrepContent;
};

/**
 * 求職者本人に共有済みの面談対策 1 件(本文込み)を取得。
 * 認可:referral → client_record の linked_user_id === userId かつ linked、
 * かつ interview_preps.shared_at not null。いずれか欠けたら null(存在を隠す)。
 */
export async function getSharedInterviewPrepForSeeker(
  referralId: string,
  userId: string,
): Promise<SharedInterviewPrepDetail | null> {
  const service = createServiceClient();

  const { data: referralRow } = await service
    .from("referrals")
    .select(
      `
      id,
      organization_id,
      client_records ( linked_user_id, link_status ),
      job_postings ( company_name, position )
    `,
    )
    .eq("id", referralId)
    .maybeSingle();
  if (!referralRow) return null;

  const referral = referralRow as unknown as SeekerReferralRow & {
    client_records:
      | { linked_user_id: string | null; link_status: string | null }
      | { linked_user_id: string | null; link_status: string | null }[]
      | null;
  };
  const clientRecord = Array.isArray(referral.client_records)
    ? referral.client_records[0]
    : referral.client_records;
  if (
    !clientRecord ||
    clientRecord.link_status !== "linked" ||
    clientRecord.linked_user_id !== userId
  ) {
    return null;
  }

  const { data: prepRow } = await service
    .from("interview_preps")
    .select("encrypted_content, shared_at")
    .eq("referral_id", referralId)
    .not("shared_at", "is", null)
    .maybeSingle();
  if (!prepRow) return null;
  const prep = prepRow as { encrypted_content: string; shared_at: string | null };

  const { data: orgRow } = await service
    .from("organizations")
    .select("name")
    .eq("id", referral.organization_id)
    .maybeSingle();
  const organizationName = (orgRow as { name: string } | null)?.name ?? "エージェント";

  const json = await decryptField(prep.encrypted_content);

  return {
    referralId,
    organizationName,
    jobLabel: jobLabelOf(referral.job_postings),
    sharedAt: prep.shared_at,
    content: parseContent(json),
  };
}
