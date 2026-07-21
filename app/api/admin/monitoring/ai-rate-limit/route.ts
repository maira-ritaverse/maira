import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { getRecentAnthropic429Count } from "@/lib/ai/rate-limit-monitor";

/**
 * GET /api/admin/monitoring/ai-rate-limit
 *
 * Anthropic API の 429 発生 状況 を 3 段階 の 時間 窓 で 返す。
 * Myaira プラットフォーム 管理者 のみ 参照 可 (RLS 経由 は 使わ ず 明示 検査)。
 *
 * レスポンス:
 *   {
 *     recent_60s:  number,
 *     recent_15m:  number,
 *     recent_60m:  number,
 *     throttled:   boolean   // 60s で 5 件 以上 なら true
 *   }
 *
 * 用途: 運用 監視 (Vercel Function Logs や 監視 SaaS が 未 導入 の 間 の 暫定 UI)。
 */
export async function GET() {
  const admin = await isMairaAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [recent60s, recent15m, recent60m] = await Promise.all([
    getRecentAnthropic429Count(60),
    getRecentAnthropic429Count(15 * 60),
    getRecentAnthropic429Count(60 * 60),
  ]);

  return NextResponse.json({
    recent_60s: recent60s,
    recent_15m: recent15m,
    recent_60m: recent60m,
    throttled: recent60s >= 5,
  });
}
