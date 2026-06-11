import { NextResponse } from "next/server";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/notifications
 *
 * 自分の通知の最新 30 件を、ペイロードを復号して返す。
 * 平文返却で良い理由:本人の通知なので本人ブラウザに渡る分には機密境界を越えない。
 *
 * 認可:RLS(SELECT は user_id = auth.uid())で他人の行は読めない。
 * .eq("user_id", user.id) は二重防御として明示する。
 *
 * 復号失敗時の方針:1件の復号失敗で全体を 500 にしない(他通知が見えなくなる
 * のは UX として悪い)。当該行の payload を null にして残りを返す。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, channel, encrypted_payload, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load notifications", message: error.message },
      { status: 500 },
    );
  }

  const notifications = await Promise.all(
    (data ?? []).map(async (row) => {
      let payload: unknown = null;
      if (row.encrypted_payload) {
        try {
          const plain = await decryptField(row.encrypted_payload as string);
          if (typeof plain === "string" && plain.length > 0) {
            payload = JSON.parse(plain);
          }
        } catch (e) {
          console.error("[notifications] decrypt failed", {
            id: row.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return {
        id: row.id,
        kind: row.kind,
        channel: row.channel,
        readAt: row.read_at,
        createdAt: row.created_at,
        payload,
      };
    }),
  );

  return NextResponse.json({ notifications });
}
