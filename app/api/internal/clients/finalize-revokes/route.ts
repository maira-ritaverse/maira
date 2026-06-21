import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET/POST /api/internal/clients/finalize-revokes
 *
 * 二段階解除 P6 の cron。 RPC auto_finalize_expired_revokes を 呼んで
 * revoke_deadline 超過 の revoke_requested 行 を まとめて revoked に 確定 する。
 *
 * 認証 は CRON_SECRET / INTAKE_CRON_SECRET (Authorization: Bearer)。
 * Vercel Cron は CRON_SECRET を 自動 付与。
 *
 * Vercel Cron 登録: vercel.json で 1 日 1 回 (`0 3 * * *` = JST 12 時 / UTC 3 時)。
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json({ error: "CRON_SECRET 未設定" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("auto_finalize_expired_revokes");
  if (error) {
    return NextResponse.json({ error: "rpc_failed", message: error.message }, { status: 500 });
  }

  const finalizedCount = typeof data === "number" ? data : Number(data) || 0;
  return NextResponse.json({ ok: true, finalizedCount });
}

export const GET = POST;
