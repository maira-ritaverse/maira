import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { multicastMessage, type LineMessage } from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/broadcasts
 * 配信履歴 を 返す (新しい順、 max 50 件)。
 *
 * POST /api/agency/line/broadcasts
 * テキスト 一斉配信 を 開始。 同期的 に 500 人 ずつ multicast を 実行。
 *
 * 入力:
 *   { text, target: 'all'|'linked'|'unlinked' }
 *
 * 課金 通数 = 実 配信数 (failed 含まず)。 UI に 表示。
 */
const SLICE_SIZE = 500;

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("line_broadcasts")
    .select(
      "id, created_by_user_id, message_type, target_filter, target_count, status, sent_count, failed_count, scheduled_for, sent_at, error_message, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  type BroadcastRow = {
    id: string;
    created_by_user_id: string;
    message_type: string;
    target_filter: { kind: "all" | "linked" | "unlinked" };
    target_count: number;
    status: "queued" | "sending" | "sent" | "failed";
    sent_count: number;
    failed_count: number;
    scheduled_for: string | null;
    sent_at: string | null;
    error_message: string | null;
    created_at: string;
  };

  const rows = (data ?? []) as BroadcastRow[];
  return NextResponse.json({
    broadcasts: rows.map((b) => ({
      id: b.id,
      createdByUserId: b.created_by_user_id,
      messageType: b.message_type,
      targetKind: b.target_filter.kind,
      targetCount: b.target_count,
      status: b.status,
      sentCount: b.sent_count,
      failedCount: b.failed_count,
      sentAt: b.sent_at,
      errorMessage: b.error_message,
      createdAt: b.created_at,
    })),
  });
}

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  target: z.enum(["all", "linked", "unlinked"]),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { text, target } = parsed.data;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  // ターゲット 取得 (unfollowed 除外)
  let query = admin
    .from("line_user_links")
    .select("line_user_id, client_record_id")
    .eq("organization_id", guard.organization.id)
    .is("unfollowed_at", null);
  if (target === "linked") {
    query = query.not("client_record_id", "is", null);
  } else if (target === "unlinked") {
    query = query.is("client_record_id", null);
  }
  const { data: userRows } = await query;
  type LinkRow = { line_user_id: string };
  const userIds = ((userRows ?? []) as LinkRow[]).map((r) => r.line_user_id);

  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "no_recipients", message: "対象 ユーザー が いません" },
      { status: 400 },
    );
  }

  // 配信履歴 行 を 先に INSERT (queued)
  const encryptedContent = await encryptField(text);
  if (!encryptedContent) {
    return NextResponse.json({ error: "encrypt_failed" }, { status: 500 });
  }

  const { data: bcRow, error: bcErr } = await admin
    .from("line_broadcasts")
    .insert({
      organization_id: guard.organization.id,
      created_by_user_id: guard.user.id,
      encrypted_content: encryptedContent,
      message_type: "text",
      target_filter: { kind: target },
      target_count: userIds.length,
      status: "sending",
    })
    .select("id")
    .single();
  if (bcErr || !bcRow) {
    return NextResponse.json(
      { error: "db_insert_failed", message: bcErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const broadcastId = (bcRow as { id: string }).id;

  // 500 人 ずつ multicast
  const message: LineMessage = { type: "text", text };
  let sentCount = 0;
  let failedCount = 0;
  let lastError: string | null = null;

  for (let i = 0; i < userIds.length; i += SLICE_SIZE) {
    const slice = userIds.slice(i, i + SLICE_SIZE);
    const result = await multicastMessage(channel.channelAccessToken, slice, [message]);
    if (result.ok) {
      sentCount += slice.length;
    } else {
      failedCount += slice.length;
      lastError = result.message;
    }
  }

  // 最終 ステータス
  const finalStatus = failedCount === 0 ? "sent" : sentCount > 0 ? "sent" : "failed";
  await admin
    .from("line_broadcasts")
    .update({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
      error_message: lastError,
    })
    .eq("id", broadcastId);

  return NextResponse.json({
    ok: true,
    broadcastId,
    sentCount,
    failedCount,
    estimatedCharge: sentCount, // 課金 通数 = 実 配信数
  });
}
