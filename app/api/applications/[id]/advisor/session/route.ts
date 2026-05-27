import { NextResponse } from "next/server";
import { verifyApplicationOwner } from "@/lib/applications/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * 応募アドバイザーの新規セッションを作成
 *
 * conversations に module = "application_tracker" で insert し、
 * どの応募に紐づくかを metadata.application_id に格納する。
 * これにより /app/applications/[id]/advisor/[conversationId] 側で
 * 「この conversation が本当にこの application に紐づくか」を検証できる。
 */

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, { params }: RouteParams) {
  const { id: applicationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isOwner = await verifyApplicationOwner(applicationId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: user.id,
      module: "application_tracker",
      metadata: { application_id: applicationId },
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        error: "Failed to create session",
        message: error?.message ?? "unknown",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversationId: data.id });
}
