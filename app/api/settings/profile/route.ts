import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateProfileRequestSchema } from "@/lib/settings/types";

/**
 * PATCH /api/settings/profile
 *
 * プロフィール情報(現状は表示名のみ)を更新する。
 * 認証チェックは Server Component 側でも実施するが、
 * API 直叩きも想定して getUser() で必ず確認する。
 *
 * 表示名は trim してから保存する(前後空白の混入を防ぐため)。
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateProfileRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.display_name.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
