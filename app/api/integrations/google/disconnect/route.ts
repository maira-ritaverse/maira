import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";

/**
 * POST /api/integrations/google/disconnect
 *
 * google_connections から本人の行を削除。Google 側 revoke も best-effort で実施
 * したい(google.com/o/oauth2/revoke)。現時点では DB 削除のみ。
 */
export async function POST() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const { error } = await supabase.from("google_connections").delete().eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "db_delete_failed", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
