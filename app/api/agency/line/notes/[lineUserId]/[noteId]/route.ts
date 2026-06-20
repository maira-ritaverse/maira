import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * PATCH /api/agency/line/notes/[lineUserId]/[noteId]
 * ノート 本文 を 更新。
 *
 * DELETE /api/agency/line/notes/[lineUserId]/[noteId]
 * ノート を 削除。
 *
 * 自組織 の ノート のみ 触れる (organization_id チェック)。
 */
type RouteContext = { params: Promise<{ lineUserId: string; noteId: string }> };

const patchBody = z.object({
  content: z.string().min(1).max(10_000),
});

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { noteId } = await context.params;

  // 自組織 の ノート か 確認
  const { data: row } = await guard.supabase
    .from("line_conversation_notes")
    .select("id")
    .eq("id", noteId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "note_not_found" }, { status: 404 });
  }

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const encrypted = await encryptField(parsed.data.content);
  if (!encrypted) {
    return NextResponse.json({ error: "encrypt_failed" }, { status: 500 });
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("line_conversation_notes")
    .update({ encrypted_content: encrypted })
    .eq("id", noteId)
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { noteId } = await context.params;

  const { data: row } = await guard.supabase
    .from("line_conversation_notes")
    .select("id")
    .eq("id", noteId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "note_not_found" }, { status: 404 });
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("line_conversation_notes")
    .delete()
    .eq("id", noteId)
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
