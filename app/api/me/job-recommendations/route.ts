import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { getSeekerJobRecommendations } from "@/lib/job-matching/seeker";

/**
 * GET /api/me/job-recommendations
 *
 * 求職者本人 → 自分が linked された連携エージェンシーの open 求人から、
 * キャリア棚卸し + 診断結果ベースで AI 推薦 top 5 を返す。
 *
 * キャッシュは現状省略(seeker ビューは頻度が低いため)。
 * Claude エラー時は 502 + メッセージ。
 */
export async function GET(request: Request) {
  // 「興味あり」表明済みリストも併せて返すため、ユーザ取得を先に行う
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  // 「キャッシュではなく実際に Claude を回す」場合だけクォータを消費したい。
  // まずキャッシュチェックなしで getSeekerJobRecommendations({force:false}) を呼んで
  // cached=true なら無料、cached=false で Claude が走る前に limit を判定…という設計が
  // 理想だが、現在の実装は内部でキャッシュチェック→fallthrough なので、ここでは
  // force=true のとき(ユーザが明示的に「再計算」を押したとき)だけ事前 limit チェック。
  // 通常の force=false 経路は cached を尊重し、cached=false になったときに事後カウント。
  if (force) {
    const usage = await checkAiUsageLimit(supabase, user.id, "job_recommendation_seeker");
    if (!usage.allowed) {
      return NextResponse.json(
        {
          error: "ai_quota_exceeded",
          message: usage.addon
            ? `今月の AI 推薦の上限(${usage.limit} 回)に達しました。`
            : `今月の AI 推薦の上限(${usage.limit} 回)に達しました。アドオン契約で上限が拡張されます。`,
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
  }

  try {
    // メイン推薦は内部で Claude を回す可能性があり最も重い。
    // 興味あり / 応募依頼済 のサイドクエリは推薦結果に依存しないので並列化。
    const [result, interestRowsRes, requestedRowsRes] = await Promise.all([
      getSeekerJobRecommendations({ force }),
      supabase.from("seeker_job_interests").select("job_posting_id").eq("user_id", user.id),
      supabase.rpc("list_seeker_requested_job_ids"),
    ]);
    const interestedIds = ((interestRowsRes.data ?? []) as Array<{ job_posting_id: string }>).map(
      (r) => r.job_posting_id,
    );
    const requestedIds = ((requestedRowsRes.data ?? []) as string[]).filter(Boolean);

    // Claude が実際に回った場合だけクォータを 1 消費(record → usage の順序を維持)
    if (!result.cached) {
      await recordAiUsage(supabase, user.id, "job_recommendation_seeker", {
        totalOpenJobs: result.totalOpenJobs,
      });
    }

    // 残量情報を返す(record の後、最新値を取得)
    const usageAfter = await checkAiUsageLimit(supabase, user.id, "job_recommendation_seeker");

    return NextResponse.json({
      items: result.items.map((i) => ({
        job: i.job,
        score: i.score,
        rationale: i.rationale,
      })),
      totalOpenJobs: result.totalOpenJobs,
      cached: result.cached,
      generatedAt: result.generatedAt,
      interestedJobIds: interestedIds,
      requestedJobIds: requestedIds,
      usage: {
        current: usageAfter.current,
        limit: usageAfter.limit,
        addon: usageAfter.addon,
        resetsAt: usageAfter.resetsAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "ai_call_failed", message: msg }, { status: 502 });
  }
}
