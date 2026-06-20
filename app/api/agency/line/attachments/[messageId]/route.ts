import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/attachments/[messageId]
 *
 * line_messages 行 の attachment_storage_path に 対して 署名URL を 発行 (有効 5 分)。
 * 直接 Storage URL を 漏らさず、 同 org メンバー のみ アクセス 可能。
 *
 * クエリ:
 *   ?inline=1 を 付けると 直接 リダイレクト (img タグ で 使える)
 */
type RouteContext = { params: Promise<{ messageId: string }> };

const SIGNED_URL_EXPIRES_SECONDS = 60 * 5;

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { messageId } = await context.params;

  const { data: msgRow, error } = await guard.supabase
    .from("line_messages")
    .select("id, attachment_storage_path, message_type")
    .eq("id", messageId)
    .maybeSingle();
  if (error || !msgRow) {
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }
  const msg = msgRow as {
    id: string;
    attachment_storage_path: string | null;
    message_type: string;
  };
  if (!msg.attachment_storage_path) {
    return NextResponse.json({ error: "no_attachment" }, { status: 404 });
  }

  const admin = createServiceClient();
  const { data: signed, error: signErr } = await admin.storage
    .from("line-attachments")
    .createSignedUrl(msg.attachment_storage_path, SIGNED_URL_EXPIRES_SECONDS);
  if (signErr || !signed) {
    return NextResponse.json(
      { error: "signed_url_failed", message: signErr?.message ?? "unknown" },
      { status: 500 },
    );
  }

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  if (inline) {
    return NextResponse.redirect(signed.signedUrl);
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRES_SECONDS * 1000).toISOString(),
    messageType: msg.message_type,
  });
}
