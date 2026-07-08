import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { createHearingSheet, listHearingSheets } from "@/lib/agency-client-documents/queries";
import { createHearingSheetRequestSchema } from "@/lib/agency-client-documents/types";

export async function GET(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const url = new URL(request.url);
  const clientRecordId = url.searchParams.get("client_record_id");
  if (!clientRecordId) {
    return NextResponse.json({ error: "client_record_id is required" }, { status: 400 });
  }
  const items = await listHearingSheets(clientRecordId, organization.id);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, member, supabase } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = createHearingSheetRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // cross-org record binding 防止: client_record_id が 自 org 所属 か 事前 検証。
  // RLS INSERT policy は organization_id = current_user_organization_id() のみ 検証
  // する ため、 FK 越し に 他 org の client_record を 指す ダングリング 参照 が 通って
  // しまう 実装 漏れ を app 層 で 塞ぐ (from-recording は 検証 済 だった の で 同 パターン)。
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("id, organization_id")
    .eq("id", parsed.data.client_record_id)
    .maybeSingle();
  if (
    !clientRow ||
    (clientRow as { organization_id: string }).organization_id !== organization.id
  ) {
    return NextResponse.json({ error: "client_record_not_in_organization" }, { status: 403 });
  }

  const result = await createHearingSheet({
    organizationId: organization.id,
    clientRecordId: parsed.data.client_record_id,
    meetingScheduleId: parsed.data.meeting_schedule_id ?? null,
    content: parsed.data.content,
    createdByMemberId: member.id,
  });
  if ("error" in result) {
    return NextResponse.json({ error: "create_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ item: result }, { status: 201 });
}
