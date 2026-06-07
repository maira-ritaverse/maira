import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 求職者側:エージェントから受けたクライアント連携招待を承認する
 *
 * POST /api/me/links/[clientRecordId]/accept
 *
 * 認可・遷移検証・メール一致は SECURITY DEFINER RPC(accept_client_link)で完結する。
 * クライアントから user_id / email を受け取らない:認可はサーバーの auth と
 * RPC 内の auth.uid() / current_user_email() で完結させる。
 */

type RouteParams = { params: Promise<{ clientRecordId: string }> };

function mapRpcError(message: string): { status: number; code: string; message: string } {
  if (message.includes("unauthenticated")) {
    return { status: 401, code: "unauthenticated", message: "ログインしてください" };
  }
  if (message.includes("not_found")) {
    return { status: 404, code: "not_found", message: "招待が見つかりません" };
  }
  if (message.includes("invalid_state")) {
    return {
      status: 409,
      code: "invalid_state",
      message: "現在の連携状態ではこの操作はできません",
    };
  }
  if (message.includes("email_mismatch")) {
    return {
      status: 403,
      code: "email_mismatch",
      message: "招待のメールアドレスとログイン中のアカウントが一致しません",
    };
  }
  return { status: 500, code: "unknown", message: "承認に失敗しました" };
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

  const { error } = await supabase.rpc("accept_client_link", {
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
