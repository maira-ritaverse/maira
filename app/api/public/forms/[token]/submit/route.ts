/**
 * POST /api/public/forms/[token]/submit
 *
 * フォームに回答を送信する(認証なし、公開エンドポイント)。
 * ・回答は AES-256-GCM で暗号化して form_submissions に INSERT
 * ・LINE 未連携でも受け付ける(line_user_id は任意)
 * ・LINE 連携済み line_user_id が渡された場合:
 *   1. line_user_links を lookup して client_record_id を解決
 *   2. trigger_type='form_submitted' + trigger_config.form_id 一致の Flow を enroll
 * ・fire-and-forget:Flow 起動が失敗しても submit 自体は成功扱い
 */
import { NextResponse } from "next/server";

import { encryptField } from "@/lib/crypto/field-encryption";
import { SubmitFormRequestSchema } from "@/lib/forms/types";
import { dispatchFlowTrigger } from "@/lib/ma/flow-enroller";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!token || token.length > 80) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = SubmitFormRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // フォーム存在 & 公開チェック
  const { data: form } = await admin
    .from("forms")
    .select("id, organization_id, is_published, schema_json")
    .eq("public_token", token)
    .maybeSingle();
  if (!form || !(form as { is_published: boolean }).is_published) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const formRow = form as {
    id: string;
    organization_id: string;
    schema_json: Array<{ id: string; required: boolean }>;
  };

  // required の未回答チェック(schema_json ベース)
  for (const q of formRow.schema_json) {
    if (q.required && !parsed.data.answers[q.id]?.trim()) {
      return NextResponse.json({ error: "missing_required", question_id: q.id }, { status: 400 });
    }
  }

  // LINE 連携済み lookup
  let lineUserId: string | null = null;
  let clientRecordId: string | null = null;
  if (parsed.data.line_user_id) {
    const { data: link } = await admin
      .from("line_user_links")
      .select("line_user_id, client_record_id")
      .eq("organization_id", formRow.organization_id)
      .eq("line_user_id", parsed.data.line_user_id)
      .is("unfollowed_at", null)
      .maybeSingle();
    if (link) {
      lineUserId = (link as { line_user_id: string }).line_user_id;
      clientRecordId = (link as { client_record_id: string | null }).client_record_id ?? null;
    }
  }

  // 暗号化して INSERT。 FIELD_ENCRYPTION_KEYS 未設定の場合 throw する可能性が
  // あるので try/catch で 500 メッセージを整える(公開エンドポイントなので
  // 生の error message を漏らさない)。
  let encryptedAnswers: string | null | undefined;
  try {
    encryptedAnswers = await encryptField(JSON.stringify(parsed.data.answers));
  } catch (err) {
    console.error("[forms/submit] encryptField failed", {
      formId: formRow.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: "server_misconfigured",
        message: "サーバー設定の問題により送信できませんでした。管理者にお問い合わせください。",
      },
      { status: 500 },
    );
  }
  if (!encryptedAnswers) {
    return NextResponse.json({ error: "encryption_failed" }, { status: 500 });
  }

  const { data: subRow, error: insErr } = await admin
    .from("form_submissions")
    .insert({
      organization_id: formRow.organization_id,
      form_id: formRow.id,
      line_user_id: lineUserId,
      client_record_id: clientRecordId,
      encrypted_answers: encryptedAnswers,
    })
    .select("id")
    .single();

  if (insErr || !subRow) {
    return NextResponse.json(
      { error: "insert_failed", message: insErr?.message ?? "unknown" },
      { status: 500 },
    );
  }

  // Flow 起動(LINE 連携済みのみ)
  if (lineUserId) {
    try {
      await dispatchFlowTrigger(admin, formRow.organization_id, {
        type: "form_submitted",
        line_user_id: lineUserId,
        form_id: formRow.id,
      });
    } catch (err) {
      console.warn("[forms] form_submitted dispatch failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, submission_id: subRow.id });
}
