import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * PATCH /api/agency/members/[id]/role
 *
 * メンバーの role(admin/advisor)を変更する。admin のみ実行可。
 *
 * 重要:
 *   - 最後の admin を advisor に降格させる試みは、サーバー側(RPC 内)で必ず弾く。
 *     UI ガードに依存しない。
 *   - role 更新と監査ログ挿入は RPC change_member_role 内で同一トランザクションに
 *     まとめてある(原子性)。
 *
 * RPC からのエラー識別:
 *   PostgreSQL の error code/message を見て API エラーコードに変換する。
 *     - last_admin   (P0001): 400 + 日本語メッセージ
 *     - forbidden    (42501): 403
 *     - not_found    (P0002): 404
 *     - invalid_role (22023): 400
 */

const bodySchema = z.object({
  role: z.enum(["admin", "advisor"]),
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

  // admin 限定。API 側でも一次ガード(RPC 側でも再検証する二重防御)。
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

  const { error } = await supabase.rpc("change_member_role", {
    target_member_id: id,
    new_role: parsed.data.role,
  });

  if (error) {
    // RPC が raise した例外は Supabase が message/code 経由で渡してくる
    const message = error.message ?? "";

    if (message.includes("last_admin")) {
      return NextResponse.json(
        {
          error: "last_admin",
          message: "組織には最低1人の管理者が必要です。最後の管理者は降格できません。",
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
    if (message.includes("invalid_role")) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    return NextResponse.json({ error: "Failed to change role", message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
