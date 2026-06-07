import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * エージェント側:解除申請(revoke_requested)の承認 → 即時 revoked 確定
 *
 * 設計:
 *   - POST /api/agency/clients/[id]/revoke-approve
 *     → public.approve_revoke_client_link RPC を呼ぶ
 *     (Phase 6 P4。revoke_requested → revoked、revoke_confirmed_via='agency_approved')
 *
 * 認可・遷移検証は SECURITY DEFINER RPC 側で完結する。本ハンドラは
 * 「認証 + organization_member ガード」と「RPC エラー → HTTP ステータスマッピング」
 * のみを担当する薄いラッパー(invite ルートと同じ形)。クライアントから
 * 組織IDやユーザーIDは受け取らない(成り済まし入力を排除するため)。
 *
 * 拒否・差し戻し経路は意図的に作らない(エージェントは早く確定できるだけ、
 * 本人の撤回権を守るためのポリシー)。
 */

type RouteParams = { params: Promise<{ id: string }> };

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
  return { status: 500, code: "unknown", message: "承認に失敗しました" };
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

  const { error } = await guard.supabase.rpc("approve_revoke_client_link", {
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
