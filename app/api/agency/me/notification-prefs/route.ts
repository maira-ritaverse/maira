import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { notificationPrefsSchema } from "@/lib/notifications/prefs";

/**
 * /api/agency/me/notification-prefs
 *   GET   - 自分の通知設定を返す
 *   PATCH - 通知設定を更新(部分更新)
 *
 * organization_members.notification_prefs に保存。自組織 × 自ユーザーの 1 行のみ更新。
 */

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, member } = guard;

  const { data, error } = await supabase
    .from("organization_members")
    .select("notification_prefs")
    .eq("id", member.id)
    .is("removed_at", null)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ prefs: {} });
  }
  return NextResponse.json({ prefs: data.notification_prefs ?? {} });
}

export async function PATCH(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, member } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = notificationPrefsSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("organization_members")
    .update({ notification_prefs: parsed.data })
    .eq("id", member.id)
    .is("removed_at", null);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}
