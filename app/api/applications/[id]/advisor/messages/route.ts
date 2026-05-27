import { NextResponse } from "next/server";
import { verifyApplicationOwner } from "@/lib/applications/queries";
import { getMessages } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/applications/[id]/advisor/messages?conversationId=xxx
 *
 * 指定されたadvisorセッションの過去メッセージを取得する。
 * ポップアップチャット起動時、過去会話を復元するために使う。
 *
 * 二重確認:
 * - application の所有者が自分か
 * - conversation の所有者が自分で、application_tracker モジュールか
 * - conversation.metadata.application_id が URL の applicationId と一致するか
 *
 * advisor チャット本体(POST /advisor)と同じ条件で揃え、
 * 「自分の応募の自分のadvisorセッション以外は触れない」を保証する。
 */

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteParams) {
  const { id: applicationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isOwner = await verifyApplicationOwner(applicationId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  // conversation の所有・モジュール・紐づくapplication を検証
  const { data: conv } = await supabase
    .from("conversations")
    .select("user_id, module, metadata")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv || conv.user_id !== user.id || conv.module !== "application_tracker") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const metadata = (conv.metadata ?? {}) as { application_id?: string };
  if (metadata.application_id !== applicationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const messages = await getMessages(conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch messages",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}
