import { NextResponse } from "next/server";

import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";
import { syncSeatCountOrEnqueueFailure } from "@/lib/billing/seat-sync";

/**
 * DELETE /api/agency/members/[id]
 *
 * メンバー を 削除 (organization_members から 行 削除)。 admin 専用。
 *
 * 流れ:
 *   1. 呼び出し 側 が admin か チェック
 *   2. deactivate_member RPC を 呼び出し (SECURITY DEFINER で 二重 検証)
 *      ・別 org / 最後 の admin / not_found は RPC が raise
 *      ・成功 時 は 削除 対象 の 組織 ID を 返す (取得 のた め RPC 呼び出し 前 に select)
 *   3. Stripe Extra Seat quantity を 同期 (失敗 は seat_sync_failures に enqueue)
 *
 * RPC エラー コード ↔ HTTP ステータス:
 *   ・unauthenticated / not_org_member / forbidden → 403
 *   ・not_found (P0002) → 404
 *   ・last_admin (P0001) → 400
 */
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const callerRole = await getUserRole(user.id);
  if (
    callerRole.accountType !== "organization_member" ||
    !callerRole.member ||
    callerRole.member.role !== "admin" ||
    !callerRole.organization
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 自 分 自身 を 削除 させ ない (最後 の admin 判定 も RPC 側 で 行う が、
  //  UX 上 も 「自 分 を 削除 する リンク」 は 描画 させ ない 前提)
  if (callerRole.member.id === id) {
    return NextResponse.json(
      {
        error: "cannot_remove_self",
        message: "自 分 自身 を メンバー から 削除 することは できません。",
      },
      { status: 400 },
    );
  }

  const organizationId = callerRole.organization.id;

  const { error } = await supabase.rpc("deactivate_member", {
    target_member_id: id,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("unauthenticated")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message.includes("not_org_member") || message.includes("forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (message.includes("last_admin")) {
      return NextResponse.json(
        {
          error: "last_admin",
          message:
            "組織 に は 最低 1 人 の 管理者 が 必要 です。 最後 の 管理者 は 削除 できません。",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Failed to remove member", message }, { status: 500 });
  }

  // Stripe Extra Seat 同期 (失敗 しても メンバー 削除 は 成功 扱い、 cron が 直す)
  await syncSeatCountOrEnqueueFailure({
    organizationId,
    reason: "member_removed",
  }).catch((e) => {
    console.warn("[deactivate_member] seat sync enqueue failed", e);
  });

  return NextResponse.json({ success: true });
}
