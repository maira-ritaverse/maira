import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import {
  createAgencyClientResume,
  listAgencyClientResumes,
} from "@/lib/agency-client-documents/queries";
import {
  clientRecordToEducationHistory,
  clientRecordToLicenses,
  clientRecordToResumePii,
} from "@/lib/agency-client-documents/client-record-to-document";
import { createAgencyClientResumeRequestSchema } from "@/lib/agency-client-documents/types";
import { generateAddressKana } from "@/lib/ai/generate-address-kana";
import { getClientRecordWithDecrypted } from "@/lib/clients/queries";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";

// POST は住所フリガナの AI 生成が同期で走り得るため、Node ランタイム + 余裕ある実行時間を明示。
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET  /api/agency/client-resumes?client_record_id=...
 *   組織所有の履歴書を 1 クライアント分まとめて返す。
 * POST /api/agency/client-resumes
 *   新規作成。
 *
 * 認可:requireOrgMember(archived ガード込み)。
 * RLS と二重防御で organization_id を明示一致。
 */
export async function GET(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const url = new URL(request.url);
  const clientRecordId = url.searchParams.get("client_record_id");
  if (!clientRecordId) {
    return NextResponse.json({ error: "client_record_id is required" }, { status: 400 });
  }

  const items = await listAgencyClientResumes(clientRecordId, organization.id);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, member, supabase, user } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = createAgencyClientResumeRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // cross-org 防止 + プロフィール自動反映のため復号込みで取得する。
  // RLS で同一組織のみ返るが、二重防御で organizationId も明示照合する。
  const client = await getClientRecordWithDecrypted(parsed.data.client_record_id);
  if (!client || client.organizationId !== organization.id) {
    return NextResponse.json({ error: "client_record_not_in_organization" }, { status: 403 });
  }

  // 明示指定が無い新規作成時は、顧客プロフィール(client_record)から履歴書項目を自動反映する。
  let pii = parsed.data.pii ?? clientRecordToResumePii(client);
  // 住所フリガナは client_record に元データが無いので、漢字住所から AI 生成して補完する
  // (書類取り込み側は Vision 抽出で対応済み。ここはプロフィール側の生成)。
  // ベストエフォート:クォータ超過や生成失敗時はフリガナ空のまま作成を続行する。
  let addressKanaGenerated = false;
  if (!parsed.data.pii && !pii.address_kana && pii.address) {
    const usage = await checkAiUsageLimit(supabase, user.id, "agency_client_document_extract");
    if (usage.allowed) {
      const kana = await generateAddressKana(pii.address);
      if (kana) {
        pii = { ...pii, address_kana: kana };
        addressKanaGenerated = true;
      }
    }
  }

  const result = await createAgencyClientResume({
    organizationId: organization.id,
    clientRecordId: parsed.data.client_record_id,
    createdByMemberId: member.id,
    title: parsed.data.title,
    documentDate: parsed.data.document_date ?? null,
    pii,
    educationHistory: parsed.data.education_history ?? clientRecordToEducationHistory(client),
    licenses: parsed.data.licenses ?? clientRecordToLicenses(client),
  });

  if ("error" in result) {
    return NextResponse.json({ error: "create_failed", message: result.error }, { status: 500 });
  }

  // 課金は作成成功後にのみ行う(作成失敗時に課金だけ残るのを避け、from-document と挙動を揃える)。
  if (addressKanaGenerated) {
    await recordAiUsage(supabase, user.id, "agency_client_document_extract", {
      kind: "address_kana_gen",
      client_record_id: parsed.data.client_record_id,
    });
  }
  return NextResponse.json({ item: result }, { status: 201 });
}
