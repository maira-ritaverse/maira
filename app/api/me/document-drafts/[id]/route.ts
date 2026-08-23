import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createCv } from "@/lib/cvs/queries";
import {
  agencyCvPayloadToSaveRequest,
  agencyResumePayloadToSaveRequest,
} from "@/lib/doc-drafts/accept-mapper";
import { documentDraftPayloadSchema } from "@/lib/doc-drafts/types";
import { createResume } from "@/lib/resumes/queries";
import { createServiceClient } from "@/lib/supabase/service";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

/**
 * PATCH /api/me/document-drafts/[id]
 *
 * 求職者が自分宛のドラフトを受領 / 辞退する。
 * - accept:payload を復号 → 本人の履歴書 / 職務経歴書を作成(クォータ免除)し、
 *   status='accepted' + accepted_into_id=新規書類 id を記録。
 *   これまで status だけ更新して本人の書類が一切作られない不具合だった。
 * - reject:status='rejected' にし、エージェント側の pushed_to_draft_id を service role で
 *   クリアして再送付を可能にする(従来は永久に「送付済み」で再送不可だった)。
 *
 * 認可は RLS(ddfa_seeker_update)で本人 + linked client_record の関係を担保。
 * status 遷移は一度きり(submitted のときだけ操作可能)。
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { id } = await params;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const p = patchSchema.safeParse(json.body);
  if (!p.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { action } = p.data;

  // 現在状態確認 + accept 用に payload / 種別 / タイトルも取得(submitted のときだけ操作可能)
  const { data: row, error: getErr } = await supabase
    .from("document_drafts_from_agency")
    .select("id, status, document_type, title, encrypted_payload")
    .eq("id", id)
    .maybeSingle();
  if (getErr || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const draft = row as {
    id: string;
    status: string;
    document_type: "resume" | "cv";
    title: string;
    encrypted_payload: string;
  };
  if (draft.status !== "submitted") {
    return NextResponse.json(
      { error: "invalid_status", message: "既に処理済みのドラフトです" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  if (action === "reject") {
    const { error: upErr } = await supabase
      .from("document_drafts_from_agency")
      .update({ status: "rejected", rejected_at: now })
      .eq("id", id);
    if (upErr) {
      return NextResponse.json({ error: "update_failed", message: upErr.message }, { status: 500 });
    }
    // エージェント側の pushed_to_draft_id をクリアして再送付を可能にする。求職者は
    // agency 側テーブルを RLS で触れないため service role で該当 draft の紐付けを外す。
    try {
      const service = createServiceClient();
      const table =
        draft.document_type === "resume" ? "agency_client_resumes" : "agency_client_cvs";
      await service.from(table).update({ pushed_to_draft_id: null }).eq("pushed_to_draft_id", id);
    } catch (err) {
      // 紐付け解除の失敗は致命ではない(辞退自体は完了)。ログのみ。
      console.error("[document-drafts] reject: pushed_to_draft_id クリア失敗", {
        id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return NextResponse.json({ ok: true });
  }

  // ===== accept: payload を復号 → 本人の書類を作成 =====
  let payload;
  try {
    const plain = await decryptField(draft.encrypted_payload);
    payload = documentDraftPayloadSchema.parse(JSON.parse(plain ?? ""));
  } catch {
    return NextResponse.json(
      { error: "payload_invalid", message: "送付内容を読み取れませんでした。" },
      { status: 422 },
    );
  }

  // 変換(求職者スキーマでの検証)は予約より前に実施する。ここで失敗しても draft は
  // submitted のまま残り、エージェント修正後の再送 / 本人の再受領ができる。
  let mapped:
    | { type: "resume"; req: ReturnType<typeof agencyResumePayloadToSaveRequest> }
    | { type: "cv"; req: ReturnType<typeof agencyCvPayloadToSaveRequest> };
  try {
    mapped =
      draft.document_type === "resume"
        ? { type: "resume", req: agencyResumePayloadToSaveRequest(payload, draft.title) }
        : { type: "cv", req: agencyCvPayloadToSaveRequest(payload, draft.title) };
  } catch {
    return NextResponse.json(
      { error: "payload_invalid", message: "送付内容を取り込める形式に変換できませんでした。" },
      { status: 422 },
    );
  }

  // CAS 予約:submitted のときだけ accepted へ原子的に遷移し、勝者のみが作成へ進む。
  // 二重クリック / 並行受領による書類の二重作成を防ぐ(final UPDATE を条件なしにすると
  // 両者が作成できてしまうため、ここで status='submitted' を条件に確保する)。
  const { data: reserved, error: reserveErr } = await supabase
    .from("document_drafts_from_agency")
    .update({ status: "accepted", accepted_at: now })
    .eq("id", id)
    .eq("status", "submitted")
    .select("id");
  if (reserveErr) {
    return NextResponse.json(
      { error: "update_failed", message: reserveErr.message },
      { status: 500 },
    );
  }
  if (!reserved || reserved.length === 0) {
    return NextResponse.json(
      { error: "invalid_status", message: "既に処理済みのドラフトです" },
      { status: 409 },
    );
  }

  // 書類作成。失敗したら予約を submitted へ戻し、本人が再受領できるようにする
  // (書類は作られていないので巻き戻しても重複しない)。
  let acceptedIntoId: string;
  try {
    acceptedIntoId =
      mapped.type === "resume"
        ? await createResume(user.id, mapped.req, undefined, null, true) // skipQuota=受領は取込
        : await createCv(user.id, mapped.req, null, true);
  } catch (err) {
    await supabase
      .from("document_drafts_from_agency")
      .update({ status: "submitted", accepted_at: null })
      .eq("id", id);
    return NextResponse.json(
      {
        error: "import_failed",
        message: "書類の取り込みに失敗しました。時間を置いて再度お試しください。",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // 取込先 id を記録(既に status=accepted で確保済みのため、ここが失敗しても二重作成は
  // 起きない。トレース id が欠落するだけなので致命ではない)。
  const { error: linkErr } = await supabase
    .from("document_drafts_from_agency")
    .update({ accepted_into_id: acceptedIntoId })
    .eq("id", id);
  if (linkErr) {
    console.error("[document-drafts] accepted_into_id 記録失敗", { id, message: linkErr.message });
  }
  return NextResponse.json({
    ok: true,
    acceptedIntoId,
    documentType: draft.document_type,
  });
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
