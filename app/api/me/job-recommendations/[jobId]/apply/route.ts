import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { notifyAgencyOfSeekerAction } from "@/lib/notifications/seeker-action";

type RouteParams = { params: Promise<{ jobId: string }> };

/**
 * POST /api/me/job-recommendations/[jobId]/apply
 *
 * 求職者が「応募を依頼」する。referrals に行を作って agency に渡す。
 * 認可と insert は RPC `request_referral_as_seeker` で完結(SECURITY DEFINER)。
 *
 * 重複時(既存 referral あり)はその id を返す。
 */
export async function POST(_: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { jobId } = await params;

  const { data: referralId, error } = await supabase.rpc("request_referral_as_seeker", {
    p_job_posting_id: jobId,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 404 : 500;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  // 通知:apply 経路では client_record を別途引いて渡す
  // (referral RPC が成功した = linked 関係は保証されているが、client_record_id は
  //  ここでもう一度引く必要がある。共通ヘルパは client_record_id を渡せば
  //  内部で表示名を解決し、null なら email ローカル部にフォールバックする)
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("id")
    .eq("linked_user_id", user.id)
    .eq("link_status", "linked")
    .maybeSingle();

  await notifyAgencyOfSeekerAction({
    jobId,
    userId: user.id,
    userEmail: user.email ?? null,
    clientRecordId: (clientRow as { id: string } | null)?.id ?? null,
    actionKind: "seeker_application_request",
    actionLabel: "応募を依頼",
  }).catch((e) => console.warn("[seeker-apply] notify failed", e));

  return NextResponse.json({ ok: true, referralId });
}
