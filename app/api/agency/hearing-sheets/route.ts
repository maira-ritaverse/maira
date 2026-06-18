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
  const { organization, member } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = createHearingSheetRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
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
