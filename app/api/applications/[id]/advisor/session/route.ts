import { NextResponse } from "next/server";
import { verifyApplicationOwner } from "@/lib/applications/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * 応募アドバイザーの新規セッションを作成
 *
 * conversations に module = "application_tracker" で insert し、
 * どの応募に紐づくかを metadata.application_id に格納する。
 * これにより messages 取得 API などで
 * 「この conversation が本当にこの application に紐づくか」を検証できる。
 */

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * GET:この応募の「最新の」 advisor セッションを返す
 *
 * ポップアップチャットの起動時に呼ばれる:
 * - セッションがあれば conversationId を返す → そのまま継続会話
 * - なければ null を返す → クライアント側で POST して新規作成
 *
 * metadata->>application_id を文字列としてフィルタすることで、
 * 「この応募 × このユーザー × application_tracker」の最新1件を取得する。
 */
export async function GET(_: Request, { params }: RouteParams) {
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
    .select("id")
    .eq("user_id", user.id)
    .eq("module", "application_tracker")
    .eq("metadata->>application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch session", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversationId: data?.id ?? null });
}

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
