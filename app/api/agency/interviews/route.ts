/**
 * /api/agency/interviews
 *
 * GET  : ?referral_id=UUID で 該当 応募 の 面接 一覧 (scheduled_at 昇順)。
 * POST : 新規 面接 ラウンド の 登録 (referral_id / kind / scheduled_at)。
 *
 * 認証: organization_member のみ。 RLS で 自 組織 の レコード のみ 見える / 作れる。
 */
import { NextResponse } from "next/server";

import { listInterviewsByReferral } from "@/lib/interviews/queries";
import { createInterviewRequestSchema } from "@/lib/interviews/types";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const referralId = url.searchParams.get("referral_id");
  if (!referralId) {
    return NextResponse.json({ error: "referral_id が 必要 です" }, { status: 400 });
  }

  const interviews = await listInterviewsByReferral(referralId);
  return NextResponse.json({ interviews });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createInterviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // referral が 自 組織 の もの か 検証 (RLS で 覆う が、 二重 防御)
  const { data: referralRow } = await supabase
    .from("referrals")
    .select("id, organization_id")
    .eq("id", d.referral_id)
    .maybeSingle();
  if (!referralRow || referralRow.organization_id !== role.organization.id) {
    return NextResponse.json({ error: "referral が 見つかり ませ ん" }, { status: 404 });
  }

  const { data: inserted, error } = await supabase
    .from("interviews")
    .insert({
      organization_id: role.organization.id,
      referral_id: d.referral_id,
      kind: d.kind,
      scheduled_at: d.scheduled_at,
      notes: d.notes ?? null,
      created_by_user_id: user.id,
      // result は default 'scheduled' が セット される
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "作成 に 失敗 しま した", details: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, id: inserted.id });
}
