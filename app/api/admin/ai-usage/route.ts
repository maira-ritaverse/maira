import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { sumEstimatedCost } from "@/lib/features/ai-pricing";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/ai-usage?months=6
 *
 * 運営者用:AI 利用量の全プラットフォーム集計。
 *
 * 月別集計(直近 N か月):
 *   - kind 別カウント(photo_enhance / job_recommendation_seeker / job_recommendation_agency)
 *   - 月計
 *   - ユニークユーザ数(その月に AI を 1 回でも使った人)
 *
 * MVP 規模(数千イベント / 月)なので「全件取って JS で集計」で十分。
 * 数万を超えるようになったら DB 側で集計 RPC を作る。
 */
type Row = {
  user_id: string;
  kind: string;
  created_at: string;
};

type MonthlyBucket = {
  /** YYYY-MM */
  month: string;
  total: number;
  byKind: Record<string, number>;
  uniqueUsers: number;
  /** 推定コスト(円)。kind 別 byKind から算出。 */
  estimatedCostJpy: number;
};

export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const monthsRaw = Number(url.searchParams.get("months") ?? "6");
  const months = Number.isFinite(monthsRaw) ? Math.min(24, Math.max(1, Math.trunc(monthsRaw))) : 6;

  // 取得範囲:今月の頭から N か月前まで
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const sinceIso = since.toISOString();

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("ai_usage_events")
    .select("user_id, kind, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "list_failed", message: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Row[];

  // 月別バケットを準備(古い → 新しい順)
  const buckets: MonthlyBucket[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      total: 0,
      byKind: {},
      uniqueUsers: 0,
      estimatedCostJpy: 0,
    });
  }
  const bucketByMonth = new Map(buckets.map((b) => [b.month, b]));
  const usersByMonth = new Map<string, Set<string>>(
    buckets.map((b) => [b.month, new Set<string>()]),
  );

  for (const r of rows) {
    const d = new Date(r.created_at);
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = bucketByMonth.get(ym);
    if (!bucket) continue;
    bucket.total += 1;
    bucket.byKind[r.kind] = (bucket.byKind[r.kind] ?? 0) + 1;
    usersByMonth.get(ym)?.add(r.user_id);
  }
  for (const b of buckets) {
    b.uniqueUsers = usersByMonth.get(b.month)?.size ?? 0;
    b.estimatedCostJpy = sumEstimatedCost(b.byKind);
  }

  // 今月サマリ
  const thisMonth = buckets[buckets.length - 1] ?? null;
  const grandTotalCost = buckets.reduce((s, b) => s + b.estimatedCostJpy, 0);

  return NextResponse.json({
    months,
    buckets,
    thisMonth,
    grandTotal: buckets.reduce((s, b) => s + b.total, 0),
    grandTotalCostJpy: Math.round(grandTotalCost * 100) / 100,
  });
}
