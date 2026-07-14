import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { listJobPostings } from "@/lib/jobs/queries";
import {
  computeCurrentInputsHash,
  getCachedRecommendation,
  recomputeAndCacheRecommendation,
} from "@/lib/job-matching/queries";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/agency/clients/[id]/job-matches?force=1
 *
 * AI による求人マッチング推薦(top 5)を返す。
 *
 * - force=1 で再計算強制(キャッシュ無視)
 * - 入力ハッシュが現状と一致しない場合も再計算
 * - 結果は client_job_ai_recommendations にキャッシュ
 */
export async function GET(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, user } = guard;

  const { id: clientRecordId } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  // クライアントは同組織所有(RLS で担保される)
  const { data: clientRow, error: cErr } = await supabase
    .from("client_records")
    .select("id, organization_id, updated_at, desired_annual_income, desired_locations")
    .eq("id", clientRecordId)
    .maybeSingle();
  if (cErr || !clientRow) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }
  if (clientRow.organization_id !== organization.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 主要 3 系統を並列取得:open 求人 / 連携 user_id / linked された場合の interest 集合は
  // クライアント情報があれば独立に進められる(linked_user_id 取得は早い)。
  // 興味あり集合だけは linked_user_id に依存するので 2 段階で取得する。
  const [allJobs, linkedUserRow] = await Promise.all([
    listJobPostings(organization.id),
    supabase.from("client_records").select("linked_user_id").eq("id", clientRecordId).maybeSingle(),
  ]);
  const openJobs = allJobs.filter((j) => j.status === "open");
  if (openJobs.length === 0) {
    return NextResponse.json({
      items: [],
      generatedAt: null,
      cached: false,
      note: "open 求人がありません",
    });
  }

  const inputsHash = await computeCurrentInputsHash({ client: clientRow, jobs: openJobs });

  // 「興味あり」表明済み job_posting_id の集合(seeker 側で表明した求人)
  const linkedUserId = (linkedUserRow.data as { linked_user_id: string | null } | null)
    ?.linked_user_id;
  let interestedJobIds: string[] = [];
  if (linkedUserId) {
    const { data: interestRows } = await supabase
      .from("seeker_job_interests")
      .select("job_posting_id")
      .eq("user_id", linkedUserId);
    interestedJobIds = (interestRows ?? []).map(
      (r: { job_posting_id: string }) => r.job_posting_id,
    );
  }

  // 「紹介中」の求人 ID 集合(referrals が既にあるもの。declined / unlinked 含む全体)
  // UI で「+ 紹介する」ボタンと「紹介中」バッジを出し分けるために使う
  const { data: refRows } = await supabase
    .from("referrals")
    .select("job_posting_id, status")
    .eq("client_record_id", clientRecordId);
  const referralByJobId: Record<string, string> = {};
  for (const r of (refRows ?? []) as Array<{ job_posting_id: string; status: string }>) {
    referralByJobId[r.job_posting_id] = r.status;
  }

  // キャッシュチェック
  if (!force) {
    const cached = await getCachedRecommendation({
      clientRecordId,
      currentInputsHash: inputsHash,
    });
    if (cached && cached.isFresh) {
      // 残量も返す(UI 表示用)
      const usageNow = await checkAiUsageLimit(supabase, user.id, "job_recommendation_agency");
      return NextResponse.json({
        items: cached.ranking.items,
        generatedAt: cached.generatedAt,
        cached: true,
        interestedJobIds,
        referralByJobId,
        usage: {
          current: usageNow.current,
          limit: usageNow.limit,
          addon: usageNow.addon,
          resetsAt: usageNow.resetsAt,
        },
      });
    }
  }

  // Claude を実際に回す前にクォータチェック
  const usage = await checkAiUsageLimit(supabase, user.id, "job_recommendation_agency");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "ai_quota_exceeded",
        message: usage.addon
          ? `今月の AI 求人推薦の上限(${usage.limit} 回)に達しました。`
          : `今月の AI 求人推薦の上限(${usage.limit} 回)に達しました。アドオン契約で上限が拡張されます。`,
        usage: {
          current: usage.current,
          limit: usage.limit,
          addon: usage.addon,
          resetsAt: usage.resetsAt,
        },
      },
      { status: 402 },
    );
  }

  try {
    const ranking = await recomputeAndCacheRecommendation({
      client: clientRow,
      jobs: openJobs,
    });
    await recordAiUsage(supabase, user.id, "job_recommendation_agency", {
      clientRecordId,
      totalOpenJobs: openJobs.length,
    });
    const usageAfter = await checkAiUsageLimit(supabase, user.id, "job_recommendation_agency");
    return NextResponse.json({
      items: ranking.items,
      generatedAt: new Date().toISOString(),
      cached: false,
      interestedJobIds,
      referralByJobId,
      usage: {
        current: usageAfter.current,
        limit: usageAfter.limit,
        addon: usageAfter.addon,
        resetsAt: usageAfter.resetsAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "ai_call_failed", message: msg }, { status: 502 });
  }
}
