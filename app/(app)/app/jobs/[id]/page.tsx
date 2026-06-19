import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getJobForSeeker } from "@/lib/jobs/seeker-queries";

import { SeekerJobDetailView } from "./job-detail-view";

/**
 * 求職者向け 求人 詳細ページ(Indeed 風)
 *
 * 認可:
 *   ・未ログインは /login へ
 *   ・自分が linked された 連携エージェンシーの open 求人 のみ 閲覧可
 *     (RPC get_job_for_seeker 側で 認可、それ以外は notFound)
 *
 * 興味あり / 応募依頼済 状態は サーバで 並列取得して 初期表示に 反映。
 * その後 のトグル / 依頼 は Client Component 側で /api/me/job-recommendations/*
 * 経路を 既存通り 叩く。
 */

type RouteParams = { params: Promise<{ id: string }> };

export default async function SeekerJobDetailPage({ params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const job = await getJobForSeeker(id);
  if (!job) notFound();

  const [interestRes, requestedRes] = await Promise.all([
    supabase
      .from("seeker_job_interests")
      .select("job_posting_id")
      .eq("user_id", user.id)
      .eq("job_posting_id", id)
      .maybeSingle(),
    supabase.rpc("list_seeker_requested_job_ids"),
  ]);
  const initiallyInterested = Boolean(interestRes.data);
  const requestedIds = ((requestedRes.data ?? []) as string[]).filter(Boolean);
  const initiallyRequested = requestedIds.includes(id);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <p className="text-muted-foreground text-xs">
        <Link href="/app/recommended-jobs" className="hover:underline">
          ← AI 求人推薦に戻る
        </Link>
      </p>
      <SeekerJobDetailView
        job={job}
        initiallyInterested={initiallyInterested}
        initiallyRequested={initiallyRequested}
      />
    </div>
  );
}
