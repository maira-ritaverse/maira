import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 求職者側:確立済みの連携を解除する
 *
 * POST /api/me/links/[clientRecordId]/revoke
 *
 * 認可・遷移検証は SECURITY DEFINER RPC(revoke_client_link)で完結する。
 * 本人判定は linked_user_id = auth.uid()(linked 後にメールが変わるケースも
 * 安定して通すため、メール一致ではなく確定済み linked_user_id で見る)。
 */

type RouteParams = { params: Promise<{ clientRecordId: string }> };

function mapRpcError(message: string): { status: number; code: string; message: string } {
  if (message.includes("unauthenticated")) {
    return { status: 401, code: "unauthenticated", message: "ログインしてください" };
  }
  if (message.includes("forbidden")) {
    return { status: 403, code: "forbidden", message: "この連携を解除する権限がありません" };
  }
  if (message.includes("not_found")) {
    return { status: 404, code: "not_found", message: "連携が見つかりません" };
  }
  if (message.includes("invalid_state")) {
    return {
      status: 409,
      code: "invalid_state",
      message: "現在の連携状態ではこの操作はできません",
    };
  }
  return { status: 500, code: "unknown", message: "連携解除に失敗しました" };
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { clientRecordId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.rpc("revoke_client_link", {
    p_client_record_id: clientRecordId,
  });

  if (error) {
    const mapped = mapRpcError(error.message ?? "");
    return NextResponse.json(
      { error: mapped.code, message: mapped.message },
      { status: mapped.status },
    );
  }

  return NextResponse.json({ success: true });
}
