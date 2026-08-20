import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * ユーザーの「最終アクセス」時刻(profiles.last_seen_at)を更新するヘルパー。
 *
 * なぜ必要か:
 *   auth.users.last_sign_in_at は「明示的なサインイン時」にしか更新されないため、
 *   セッションを保ったまま毎日使っているユーザーでも古い値のまま残り、運営者画面の
 *   最終アクセス精度が悪かった。認証後レイアウトの表示ごとにここを更新して補う。
 *
 * 書き込み負荷対策(スロットル):
 *   レイアウトは全ページ遷移で走るため、毎回 UPDATE すると書き込みが過剰になる。
 *   last_seen_at が NULL または閾値(5 分)より古いときだけ更新する条件を付け、
 *   直近に更新済みなら 0 行更新(実質 no-op)にして負荷を抑える。
 *
 * RLS:
 *   本人 id に対する更新だが、profiles の UPDATE ポリシー差異に依存したくないため
 *   service_role(createServiceClient)で確実に更新する。id は呼び出し側で認証済みの
 *   user.id を渡す前提(他人の id を渡さないこと)。
 *
 * 失敗時:
 *   after() の中(レスポンス送出後)で呼ぶ想定。表示の本筋ではないので、失敗しても
 *   握りつぶして警告ログのみ(ユーザー体験に影響させない)。
 */
const THROTTLE_MS = 5 * 60 * 1000; // 5 分

export async function touchLastSeen(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const now = new Date();
    const threshold = new Date(now.getTime() - THROTTLE_MS).toISOString();
    const admin = createServiceClient();
    // last_seen_at が NULL、または閾値より古いときだけ更新(直近更新済みなら 0 行)。
    const { error } = await admin
      .from("profiles")
      .update({ last_seen_at: now.toISOString() })
      .eq("id", userId)
      .or(`last_seen_at.is.null,last_seen_at.lt.${threshold}`);
    if (error) {
      console.warn("[profile/last-seen] update failed", { message: error.message });
    }
  } catch (e) {
    console.warn("[profile/last-seen] unexpected error", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
