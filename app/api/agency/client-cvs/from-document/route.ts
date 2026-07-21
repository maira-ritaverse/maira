import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { clientExtractionToCvBody } from "@/lib/agency-client-documents/client-record-to-document";
import { createAgencyClientCv } from "@/lib/agency-client-documents/queries";
import { getSourceDocument } from "@/lib/agency-client-source-documents/queries";
import { STORAGE_BUCKET } from "@/lib/agency-client-source-documents/types";
import {
  CLIENT_EXTRACT_MAX_BYTES,
  extractClientFromDocument,
  isSupportedClientExtractMime,
} from "@/lib/clients/ai-extract-from-document";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/client-cvs/from-document
 *
 * アップロード済みの元書類を Claude Vision で抽出し、その内容をセクション整形した
 * 本文で新しい agency_client_cvs を新規作成する。client-resumes/from-document の CV 版。
 *
 * 入力: { client_record_id, source_document_id, title? }
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  client_record_id: z.string().uuid(),
  source_document_id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member, user } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const doc = await getSourceDocument(supabase, {
    organizationId: organization.id,
    id: parsed.data.source_document_id,
  });
  if (!doc || doc.clientRecordId !== parsed.data.client_record_id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const usage = await checkAiUsageLimit(supabase, user.id, "agency_client_document_extract");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "over_quota",
        message: `組織の月次 AI 利用上限に達しました (${usage.current} / ${usage.limit})。`,
        current: usage.current,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
      },
      { status: 429 },
    );
  }

  if (!isSupportedClientExtractMime(doc.mimeType)) {
    return NextResponse.json(
      { error: "unsupported_mime", message: `AI抽出に対応していない形式です (${doc.mimeType})。` },
      { status: 400 },
    );
  }
  if (doc.fileSize > CLIENT_EXTRACT_MAX_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `AI抽出対象のファイルサイズは${CLIENT_EXTRACT_MAX_BYTES / 1024 / 1024}MB以下にしてください。`,
      },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const dl = await service.storage.from(STORAGE_BUCKET).download(doc.storagePath);
  if (dl.error || !dl.data) {
    return NextResponse.json(
      { error: "storage_read_failed", message: dl.error?.message ?? "元書類の読込に失敗しました" },
      { status: 500 },
    );
  }
  const data = new Uint8Array(await dl.data.arrayBuffer());

  const ai = await extractClientFromDocument({ data, mimeType: doc.mimeType });
  if (!ai.ok) {
    return NextResponse.json(
      {
        error: ai.reason,
        message:
          ai.reason === "schema_error"
            ? "AI出力の構造が不正でした。再度お試しください。"
            : "AI呼び出しに失敗しました。時間を置いて再度お試しください。",
        detail: ai.message,
      },
      { status: 502 },
    );
  }

  const cvBody = clientExtractionToCvBody(ai.result);

  const today = new Date().toISOString().slice(0, 10);
  const title = parsed.data.title ?? `書類から生成(${today})`;

  const created = await createAgencyClientCv({
    organizationId: organization.id,
    clientRecordId: parsed.data.client_record_id,
    createdByMemberId: member.id,
    title,
    documentDate: today,
    body: cvBody,
  });
  if ("error" in created) {
    return NextResponse.json({ error: "create_failed", message: created.error }, { status: 500 });
  }

  await service
    .from("agency_client_cvs")
    .update({ source_document_id: doc.id })
    .eq("id", created.id)
    .eq("organization_id", organization.id);

  await recordAiUsage(supabase, user.id, "agency_client_document_extract", {
    source_document_id: doc.id,
    client_record_id: parsed.data.client_record_id,
    mime_type: doc.mimeType,
    bytes: doc.fileSize,
    confidence: ai.result.confidence,
    created_cv_id: created.id,
  });

  return NextResponse.json({ item: created }, { status: 201 });
}
