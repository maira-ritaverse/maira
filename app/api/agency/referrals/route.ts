import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createReferralRequestSchema } from "@/lib/referrals/types";

/**
 * POST /api/agency/referrals
 *
 * クライアントを求人に紹介する(紐づけを作成)。
 * - 認証 + organization_member ガード
 * - client_record_id と job_posting_id がいずれも自社のものかを明示確認
 *   (RLS で守られるが、organization_id を取り違えると insert が他社に倒れないよう
 *    サーバ側で organization_id を組み立てるための検証も兼ねる)
 * - status は DB デフォルト 'planned' を使う(API では受け取らない)
 * - 二重紹介(unique 制約違反, PG code 23505)は 409 で分かりやすく返す
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
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createReferralRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { client_record_id, job_posting_id, notes } = parsed.data;
  const orgId = role.organization.id;

  // 自社のクライアント・求人かをサーバ側でも検証する。
  // RLS でも他社レコードは見えないが、ここで明示的に弾くことで
  // エラーメッセージを分かりやすくし、組織またぎの紐づけを根本的に防ぐ。
  const [{ data: clientRow }, { data: jobRow }] = await Promise.all([
    supabase
      .from("client_records")
      .select("organization_id")
      .eq("id", client_record_id)
      .maybeSingle(),
    supabase.from("job_postings").select("organization_id").eq("id", job_posting_id).maybeSingle(),
  ]);

  if (!clientRow || clientRow.organization_id !== orgId) {
    return NextResponse.json({ error: "Client not found in your organization" }, { status: 404 });
  }
  if (!jobRow || jobRow.organization_id !== orgId) {
    return NextResponse.json({ error: "Job not found in your organization" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("referrals")
    .insert({
      organization_id: orgId,
      client_record_id,
      job_posting_id,
      notes: notes || null,
      // status はDBデフォルト 'planned' に任せる
    })
    .select("id")
    .single();

  if (error || !data) {
    // 23505 = unique_violation。同じクライアントを同じ求人に二重紹介。
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "Already referred", message: "このクライアントは既にこの求人に紹介されています" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Failed to create referral", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, success: true });
}
