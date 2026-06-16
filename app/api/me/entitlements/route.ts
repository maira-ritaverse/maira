import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { getActiveAddons } from "@/lib/features/entitlements";
import { checkIntakeLimit } from "@/lib/features/usage-limits";

/**
 * GET /api/me/entitlements
 *
 * クライアント側で「アドオン契約しているか / 今月の利用状況」を取得する。
 * 設定ページや AI ヒアリング画面でのバナー出し分けに使う。
 *
 * 戻り値の形は素直に固定(将来 zod ライクなレスポンス schema を入れるとき
 * までは型で同期する)。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const [addons, intakeLimit] = await Promise.all([
    getActiveAddons(supabase, user.id),
    checkIntakeLimit(supabase, user.id),
  ]);

  return NextResponse.json({
    addons,
    usage: {
      intake: intakeLimit,
    },
  });
}
