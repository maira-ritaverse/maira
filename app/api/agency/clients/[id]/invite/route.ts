import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * エージェント側:クライアント連携の招待発行 / 取消
 *
 * 設計:
 *   - POST   /api/agency/clients/[id]/invite  → invite_client_record   (unlinked|revoked → invited)
 *   - DELETE /api/agency/clients/[id]/invite  → cancel_client_invitation (invited → unlinked)
 *
 * 認可・遷移検証・メール一致は SECURITY DEFINER RPC 側で完結する。
 * 本ハンドラは「認証 + organization_member ガード」と「RPC エラー → HTTP ステータス
 * マッピング」のみを担当する薄いラッパー。同じ手厚さの検証を二重に書かないため
 * 多くを RPC に寄せている。
 */

type RouteParams = { params: Promise<{ id: string }> };

// RPC が raise してくる例外シンボル → HTTP ステータス + ユーザー向け文言
// 既存 invite/[token]/actions.ts の前方一致パターンに揃える(error.message に
// "unauthenticated" 等のシンボルが含まれる前提で includes 判定)。
function mapRpcError(message: string): { status: number; code: string; message: string } {
  if (message.includes("unauthenticated")) {
    return { status: 401, code: "unauthenticated", message: "ログインしてください" };
  }
  if (message.includes("forbidden")) {
    return { status: 403, code: "forbidden", message: "この操作の権限がありません" };
  }
  if (message.includes("not_found")) {
    return { status: 404, code: "not_found", message: "クライアントが見つかりません" };
  }
  if (message.includes("invalid_state")) {
    return {
      status: 409,
      code: "invalid_state",
      message: "現在の連携状態ではこの操作はできません",
    };
  }
  return { status: 500, code: "unknown", message: "操作に失敗しました" };
}

async function ensureAgencyMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, supabase };
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const guard = await ensureAgencyMember();
  if (!guard.ok) return guard.response;

  const { error } = await guard.supabase.rpc("invite_client_record", {
    p_client_record_id: id,
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

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const guard = await ensureAgencyMember();
  if (!guard.ok) return guard.response;

  const { error } = await guard.supabase.rpc("cancel_client_invitation", {
    p_client_record_id: id,
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
