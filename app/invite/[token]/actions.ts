"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncSeatCountOrEnqueueFailure } from "@/lib/billing/seat-sync";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * 招待受諾 Server Action
 *
 * accept_invitation RPC を呼び出して、検証〜状態遷移〜監査ログを 1Tx で実行する。
 * RPC が raise した例外コードを 4 種類のエラーキーにマップして UI で分岐させる。
 *
 * リダイレクトは Server Action 内では行わず、成功フラグだけ返す。
 * → 呼び出し側(Client Component)で router.push する設計にすることで、
 *   redirect() の throw が Client の状態管理(button disabled 等)を
 *   置き去りにしないようにする。
 */
export type AcceptInvitationResult =
  | { ok: true; memberId: string }
  | {
      ok: false;
      // unauthenticated: ログインしていない
      // invalid_token: トークン無効/期限切れ/既受諾/取消
      // email_mismatch: ログイン中アカウントと招待メールが不一致
      // already_member: 既に組織に所属
      // has_seeker_data: 求職者として既にデータを保有
      // unknown: 想定外
      code:
        | "unauthenticated"
        | "invalid_token"
        | "email_mismatch"
        | "already_member"
        | "has_seeker_data"
        | "unknown";
      message: string;
    };

export async function acceptInvitation(token: string): Promise<AcceptInvitationResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      code: "unauthenticated",
      message: "ログインしてから受諾してください",
    };
  }

  const { data, error } = await supabase.rpc("accept_invitation", {
    invitation_token: token,
  });

  if (error) {
    // RPC が raise exception で投げてくる message に
    // 'invalid_token' 等のシンボルが入っている前提で前方一致マッチする。
    // Postgres エラーは "ERROR:  invalid_token" の形で来るため、
    // 安全側で includes() でも判定する。
    const msg = error.message ?? "";
    if (msg.includes("invalid_token")) {
      return {
        ok: false,
        code: "invalid_token",
        message: "招待リンクが無効、または期限が切れています",
      };
    }
    if (msg.includes("email_mismatch")) {
      return {
        ok: false,
        code: "email_mismatch",
        message: "招待メールと異なるアカウントでログインしています",
      };
    }
    if (msg.includes("already_member")) {
      return {
        ok: false,
        code: "already_member",
        message: "既に組織に所属しています",
      };
    }
    if (msg.includes("has_seeker_data")) {
      return {
        ok: false,
        code: "has_seeker_data",
        message:
          "求職者として既に利用中のアカウントです。エージェント参加には別のメールアドレスで招待を受けてください",
      };
    }
    if (msg.includes("unauthenticated")) {
      return {
        ok: false,
        code: "unauthenticated",
        message: "ログインしてから受諾してください",
      };
    }
    return {
      ok: false,
      code: "unknown",
      message: "受諾に失敗しました。時間を置いて再度お試しください",
    };
  }

  // 席 数 を Stripe に 同期 (Extra Seat quantity を + 1)。
  // 失敗 は seat_sync_failures に enqueue され、 cron が リトライ する ので
  // ここ で は例外 を 呼び出し 元 に 伝播 させ ない (受諾 は 既に 成立 している)。
  const admin = createServiceClient();
  const { data: memberRow } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("id", data as string)
    .maybeSingle();
  if (memberRow?.organization_id) {
    await syncSeatCountOrEnqueueFailure({
      organizationId: memberRow.organization_id,
      reason: "invitation_accepted",
    }).catch((e) => {
      console.warn("[accept_invitation] seat sync enqueue failed", e);
    });
  }

  // ロールが変わるので /agency と /app のレイアウトキャッシュを破棄する
  revalidatePath("/", "layout");

  return {
    ok: true,
    memberId: data as string,
  };
}
