import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { notifyAgencyOfSeekerAction } from "@/lib/notifications/seeker-action";

type RouteParams = { params: Promise<{ jobId: string }> };

/**
 * POST /api/me/job-recommendations/[jobId]/interest
 *
 * 求職者が AI 推薦された求人に「興味あり」を表明する。
 * 1 タップで insert(重複は unique 制約で吸収)、撤回は DELETE。
 *
 * 連携先のエージェントは agency_select RLS でこの行を読み、
 * 「○○ さんが △△ 求人に興味あり」というシグナルを CRM 上で確認できる。
 */
export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { jobId } = await params;

  // job_posting_id がそのエージェントの linked クライアントとして自分が見える求人か確認
  // (RPC 経由のクライアントから来ている前提だが、防御的に再チェック)
  const { data: jobRow } = await supabase
    .rpc("list_open_jobs_for_seeker", { p_limit: 200 })
    .then(({ data }) => {
      const list = (data ?? []) as Array<{ id: string }>;
      return { data: list.find((j) => j.id === jobId) ?? null };
    });
  if (!jobRow) {
    return NextResponse.json(
      { error: "job_not_accessible", message: "この求人にはアクセスできません" },
      { status: 404 },
    );
  }

  // どの client_record で linked されているかも記録(任意・将来の参照用)
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("id, organization_id")
    .eq("linked_user_id", user.id)
    .eq("link_status", "linked")
    .maybeSingle();

  const { data: inserted, error } = await supabase
    .from("seeker_job_interests")
    .upsert(
      {
        user_id: user.id,
        job_posting_id: jobId,
        client_record_id: clientRow?.id ?? null,
      },
      { onConflict: "user_id,job_posting_id", ignoreDuplicates: false },
    )
    .select("id, created_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  // 通知:同組織のエージェントに in-app + メール(代表 email 1 件)
  await notifyAgencyOfSeekerAction({
    jobId,
    userId: user.id,
    userEmail: user.email ?? null,
    clientRecordId: clientRow?.id ?? null,
    actionKind: "seeker_job_interest",
    actionLabel: "興味あり",
  }).catch((e) => console.warn("[seeker-interest] notify failed", e));

  return NextResponse.json({
    ok: true,
    interest: inserted,
  });
}

/**
 * DELETE /api/me/job-recommendations/[jobId]/interest
 *
 * 「興味あり」を撤回。
 */
export async function DELETE(_: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { jobId } = await params;

  const { error } = await supabase
    .from("seeker_job_interests")
    .delete()
    .eq("user_id", user.id)
    .eq("job_posting_id", jobId);
  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
