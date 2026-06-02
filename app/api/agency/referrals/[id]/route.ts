import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { updateReferralRequestSchema } from "@/lib/referrals/types";

/**
 * PATCH /api/agency/referrals/[id]
 *
 * 紹介を部分更新する(主にステータス変更・メモ更新)。
 * - 認証 + organization_member ガード(履歴記録のため role.member も必須)
 * - RLS により自社の紹介のみ更新可能。念のため organization_id でも絞る
 *   (RLS が外れた場合の二重防御)。
 * - client_record_id / job_posting_id は不変扱いなので更新対象に含めない。
 * - status が実際に変わった場合のみ referral_status_history に履歴を自動記録する。
 *   DB トリガーではなくアプリ層で記録する理由は、変更者(changed_by_member_id)を
 *   ここで持っている auth コンテキストから直接取れるため。
 */

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

  const role = await getUserRole(user.id);
  // 履歴記録で role.member.id が必要なため、member 不在時もここで弾く
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateReferralRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // undefined のフィールドは更新対象に含めない(部分更新)
  const updateData: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.status !== undefined) updateData.status = d.status;
  if (d.notes !== undefined) updateData.notes = d.notes || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  const orgId = role.organization.id;

  // 履歴記録のために更新前 status を取得する。
  // ついでに organization_id をここで読み直し、履歴の organization_id にもこれを使う
  // (current_user_organization_id() と一致するが、二重防御の意味で referral 側を採用)。
  // status を更新しない場合(notes だけの更新)はそもそも履歴記録不要なので select もスキップ。
  let previousStatus: string | null = null;
  if (d.status !== undefined) {
    const { data: current, error: fetchError } = await supabase
      .from("referrals")
      .select("status, organization_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: "Failed to load referral", message: fetchError.message },
        { status: 500 },
      );
    }
    if (!current) {
      return NextResponse.json({ error: "Referral not found" }, { status: 404 });
    }
    previousStatus = current.status as string;
  }

  const { error } = await supabase
    .from("referrals")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }

  // 更新成功後、status が実際に変わった場合だけ履歴を残す。
  //   - 同じ値の上書き(planned → planned)では何もしない(重複記録の防止)
  //   - 履歴 insert が失敗しても referrals.update 自体は成功している。
  //     ここでロールバックする手段は無いので、ログだけ残してリクエストは成功扱い。
  //     真にアトミックにしたい場合は RPC ファンクションに昇格させる前提。
  if (d.status !== undefined && d.status !== previousStatus) {
    const { error: historyError } = await supabase.from("referral_status_history").insert({
      organization_id: orgId,
      referral_id: id,
      from_status: previousStatus,
      to_status: d.status,
      changed_by_member_id: role.member.id,
      // changed_at は DB デフォルト(now())に任せる
    });

    if (historyError) {
      console.error("[referral-history] Failed to record status transition", {
        referralId: id,
        from: previousStatus,
        to: d.status,
        message: historyError.message,
      });
    }
  }

  return NextResponse.json({ success: true });
}
