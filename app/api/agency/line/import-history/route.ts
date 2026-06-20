import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { parseLineHistoryCsv } from "@/lib/line/csv-parser";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/import-history
 *
 * LINE OA Manager から エクスポート した CSV を 取込み、
 * 既存 line_messages に 追加 する。
 *
 * 入力 (multipart/form-data):
 *   ・lineUserId        対象 友達 ID
 *   ・selfSenderLabels  「自分」 と 判定 する 送信者名 (カンマ区切り)
 *   ・file              CSV ファイル
 *
 * admin 限定。 重複 (rowHash) は スキップ。
 */
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const lineUserId = form.get("lineUserId");
  const file = form.get("file");
  const selfSenderLabelsRaw = form.get("selfSenderLabels");
  if (typeof lineUserId !== "string" || lineUserId.length === 0) {
    return NextResponse.json({ error: "lineUserId required" }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  const selfSenderLabels =
    typeof selfSenderLabelsRaw === "string" && selfSenderLabelsRaw.length > 0
      ? selfSenderLabelsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const csvText = await file.text();
  const parsed = parseLineHistoryCsv(csvText, selfSenderLabels);
  if (!parsed.ok) {
    return NextResponse.json({ error: "parse_failed", reason: parsed.error }, { status: 400 });
  }

  const admin = createServiceClient();

  // 自組織 の 友達 か 確認
  const { data: linkRow } = await admin
    .from("line_user_links")
    .select("line_user_id")
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (!linkRow) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }

  // 既存 import 履歴 を 取得 して 重複 排除
  // line_messages.line_message_id を 「import:<rowHash>」形式 で 使う
  const importIds = parsed.messages.map((m) => `import:${m.rowHash}`);
  const { data: existingRows } = await admin
    .from("line_messages")
    .select("line_message_id")
    .eq("organization_id", guard.organization.id)
    .in("line_message_id", importIds);
  const existingSet = new Set(
    ((existingRows ?? []) as Array<{ line_message_id: string }>).map((r) => r.line_message_id),
  );

  // 残り を INSERT
  let inserted = 0;
  let duplicate = 0;
  const errors: string[] = [];
  const BATCH = 100;
  const toInsert: Array<Record<string, unknown>> = [];

  for (const m of parsed.messages) {
    const lineMessageId = `import:${m.rowHash}`;
    if (existingSet.has(lineMessageId)) {
      duplicate += 1;
      continue;
    }
    const encrypted = await encryptField(m.text);
    if (!encrypted) {
      errors.push(`encrypt_failed_for_one_row`);
      continue;
    }
    toInsert.push({
      organization_id: guard.organization.id,
      line_user_id: lineUserId,
      direction: m.direction,
      message_type: "text",
      encrypted_content: encrypted,
      line_message_id: lineMessageId,
      created_at: m.createdAt,
      send_status: m.direction === "outbound" ? "sent" : null,
    });
  }

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH);
    const { error } = await admin.from("line_messages").insert(slice);
    if (error) {
      errors.push(error.message);
    } else {
      inserted += slice.length;
    }
  }

  return NextResponse.json({
    ok: true,
    total: parsed.total,
    parsed: parsed.messages.length,
    inserted,
    duplicate,
    skipped: parsed.skipped,
    errors: errors.slice(0, 10),
  });
}
