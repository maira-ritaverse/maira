import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createPlacementRequestSchema } from "@/lib/placements/types";

/**
 * POST /api/agency/placements
 *
 * referral に紐づく成約イベントを1件記録する。
 * このステップ(2)では「event_type = 'placement'」のみを想定しているが、
 * 後続ステップ3で payment/refund/additional も同じエンドポイントを使う前提で、
 * スキーマレベルでは event_type を受け取れるようにしておく。
 *
 * - 認証 + organization_member ガード
 * - referral_id が自社のものか二重チェック(RLS と併せて多層防御)
 * - created_by_member_id はサーバー側でログイン中の member.id を入れる
 *   (なりすまし防止のため UI からは受けない)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createPlacementRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const {
    referral_id,
    event_type,
    amount,
    expected_salary,
    commission_rate,
    event_date,
    payment_status,
    notes,
    reason,
  } = parsed.data;
  const orgId = role.organization.id;

  // 入金イベントは「お金の確定」なので admin 限定。
  // UI でもボタンを出し分けるが、サーバ側でも強制する(多層防御)。
  // RLS では列レベル(payment_status のみ admin 限定)の表現が難しいため、
  // event_type 単位で API 層で弾く。
  if (event_type === "payment" && role.member.role !== "admin") {
    return NextResponse.json({ error: "Only admins can record payment events" }, { status: 403 });
  }

  // referral が自社のものか検証(RLS に加え明示)
  const { data: referralRow } = await supabase
    .from("referrals")
    .select("organization_id")
    .eq("id", referral_id)
    .maybeSingle();

  if (!referralRow || referralRow.organization_id !== orgId) {
    return NextResponse.json({ error: "Referral not found in your organization" }, { status: 404 });
  }

  // 空文字は null に丸める(notes/reason)
  // amount などは optional & nullable なので undefined のときはカラムを省略
  const insertPayload: Record<string, unknown> = {
    organization_id: orgId,
    referral_id,
    event_type,
    event_date,
    created_by_member_id: role.member.id,
  };
  if (amount !== undefined) insertPayload.amount = amount;
  if (expected_salary !== undefined) insertPayload.expected_salary = expected_salary;
  if (commission_rate !== undefined) insertPayload.commission_rate = commission_rate;
  if (payment_status !== undefined) insertPayload.payment_status = payment_status;
  if (notes !== undefined) insertPayload.notes = notes || null;
  if (reason !== undefined) insertPayload.reason = reason || null;

  const { data, error } = await supabase
    .from("placements")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create placement", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, success: true });
}
