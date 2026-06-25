import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { PERMISSION_KEYS } from "@/lib/permissions/types";

/**
 * PATCH /api/agency/members/[id]/permissions
 *
 * メンバーの権限フラグをトグルする(admin のみ実行可)。
 *
 * - body: { permissionKey: 'export', granted: boolean }
 * - admin は常に全権限を持つので、admin に対するトグルは弾く(RPC 側も二重防御)
 * - upsert + 監査ログは RPC change_member_permission の中で同一トランザクション
 *
 * RPC からのエラー識別:
 *   - target_admin (P0001): 400 + 「管理者は常に全権限を持つため設定できません」
 *   - forbidden    (42501): 403
 *   - not_found    (P0002): 404
 *   - invalid_key  (22023): 400
 */

const bodySchema = z.object({
  permissionKey: z.enum([PERMISSION_KEYS.EXPORT]),
  granted: z.boolean(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // admin 限定(API 側でも一次ガード、RPC 側でも再検証)
  const callerRole = await getUserRole(user.id);
  if (
    callerRole.accountType !== "organization_member" ||
    !callerRole.member ||
    callerRole.member.role !== "admin"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc("change_member_permission", {
    target_member_id: id,
    p_permission_key: parsed.data.permissionKey,
    granted: parsed.data.granted,
  });

  if (error) {
    const message = error.message ?? "";

    if (message.includes("target_admin")) {
      return NextResponse.json(
        {
          error: "target_admin",
          message: "管理者は常に全権限を持つため、個別に設定できません。",
        },
        { status: 400 },
      );
    }
    if (message.includes("forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (message.includes("invalid_key")) {
      return NextResponse.json({ error: "Invalid permission key" }, { status: 400 });
    }

    return NextResponse.json({ error: "Failed to change permission", message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
