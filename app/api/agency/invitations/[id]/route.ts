import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * PATCH /api/agency/invitations/[id]
 *
 * 招待を取り消す(status を pending → revoked)。admin のみ。
 * 本ステップでは「取り消し」アクションのみ受け付ける(再送・再発行は再度 POST で)。
 *
 * RPC からのエラー識別:
 *   - forbidden    (42501): 403
 *   - not_found    (P0002): 404
 *   - not_pending  (P0001): 既に accepted/expired/revoked 等 → 409
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  // body は { action: 'revoke' } 想定(将来 resend を足すときに拡張しやすく)
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // body 無しでも revoke 単独動作にする(下で action のデフォルトを revoke にする)
  }

  const action = (body as { action?: unknown } | null)?.action === "revoke" ? "revoke" : null;

  if (!action) {
    return NextResponse.json(
      { error: "Invalid action", message: "action は 'revoke' を指定してください。" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.member || role.member.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.rpc("revoke_invitation", {
    invitation_id: id,
  });

  if (error) {
    const message = error.message ?? "";

    if (message.includes("forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    if (message.includes("not_pending")) {
      return NextResponse.json(
        {
          error: "not_pending",
          message: "この招待は既に取り消し・受諾・期限切れになっています。",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: "Failed to revoke invitation", message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
