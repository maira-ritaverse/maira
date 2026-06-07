import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 求職者側:エージェントから受けたクライアント連携招待を拒否する
 *
 * POST /api/me/links/[clientRecordId]/reject
 *
 * 認可・遷移検証・メール一致は SECURITY DEFINER RPC(reject_client_link)で完結する。
 * メール一致を必須にしているのは、他人宛て招待を勝手に破棄できないようにするため
 * (accept と対称の防御)。
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
  return { status: 500, code: "unknown", message: "拒否に失敗しました" };
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

  const { error } = await supabase.rpc("reject_client_link", {
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
