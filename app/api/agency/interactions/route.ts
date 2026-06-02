import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createInteractionRequestSchema } from "@/lib/interactions/types";

/**
 * POST /api/agency/interactions
 *
 * クライアントへの対応履歴を1件記録する。
 * - 認証 + organization_member ガード
 * - client_record_id が自社のものかを明示確認(referrals API と同じ二重防御)
 * - referral_id が指定された場合も自社のものかを確認
 * - author_member_id は現在ログイン中の organization_members.id を自動で入れる
 *   (UI からは渡させない:なりすまし防止)
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

  const parsed = createInteractionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const {
    client_record_id,
    referral_id,
    interaction_type,
    occurred_at,
    summary,
    body: memo,
  } = parsed.data;
  const orgId = role.organization.id;

  // クライアントが自社のものか検証(RLS でも守られるが、明示的に弾く)
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("organization_id")
    .eq("id", client_record_id)
    .maybeSingle();

  if (!clientRow || clientRow.organization_id !== orgId) {
    return NextResponse.json({ error: "Client not found in your organization" }, { status: 404 });
  }

  // referral_id が指定されていれば、自社の紹介かつ同じクライアントの紹介か検証
  if (referral_id) {
    const { data: referralRow } = await supabase
      .from("referrals")
      .select("organization_id, client_record_id")
      .eq("id", referral_id)
      .maybeSingle();

    if (
      !referralRow ||
      referralRow.organization_id !== orgId ||
      referralRow.client_record_id !== client_record_id
    ) {
      return NextResponse.json(
        { error: "Referral not found or does not match the client" },
        { status: 404 },
      );
    }
  }

  const { data, error } = await supabase
    .from("client_interactions")
    .insert({
      organization_id: orgId,
      client_record_id,
      referral_id: referral_id ?? null,
      author_member_id: role.member.id,
      interaction_type,
      // occurred_at 未指定なら DB デフォルト(now())に任せる
      ...(occurred_at ? { occurred_at } : {}),
      summary: summary || null,
      body: memo || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create interaction", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, success: true });
}
