import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

/**
 * PATCH /api/me/document-drafts/[id]
 *
 * 求職者が自分宛のドラフトを受領 / 辞退する。
 * - accept:status を 'accepted' に。accepted_into_id は将来 resume/cv に取込時に埋める
 * - reject:status を 'rejected' に
 *
 * 認可は RLS(ddfa_seeker_update)で本人 + linked client_record の関係を担保。
 * status 遷移は一度きり(再度 accept/reject 不可、すでに完了状態ならエラー)。
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;
  const { id } = await params;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const p = patchSchema.safeParse(json.body);
  if (!p.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { action } = p.data;

  // 現在状態確認(submitted のときだけ操作可能)
  const { data: row, error: getErr } = await supabase
    .from("document_drafts_from_agency")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (getErr || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if ((row as { status: string }).status !== "submitted") {
    return NextResponse.json(
      { error: "invalid_status", message: "既に処理済みのドラフトです" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const updates =
    action === "accept"
      ? { status: "accepted" as const, accepted_at: now }
      : { status: "rejected" as const, rejected_at: now };

  const { error: upErr } = await supabase
    .from("document_drafts_from_agency")
    .update(updates)
    .eq("id", id);
  if (upErr) {
    return NextResponse.json({ error: "update_failed", message: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/me/document-drafts/[id]
 *
 * 求職者が自分宛のドラフトを削除(reject 後の片付け等)。
 * RLS で本人のみ。
 */
export async function DELETE(_: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;
  const { id } = await params;

  const { error } = await supabase.from("document_drafts_from_agency").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
