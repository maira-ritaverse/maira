import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/onboarding/complete
 *
 * オンボーディングツアーの完了をマークする。
 * profiles.onboarded_at に現在時刻を書き込むことで、次回ログイン以降は
 * ツアーが自動起動しなくなる。
 *
 * 認証チェックは API 直叩きも想定して getUser() で必ず確認する。
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("profiles")
    .update({
      onboarded_at: now,
      updated_at: now,
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to mark onboarding complete", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
