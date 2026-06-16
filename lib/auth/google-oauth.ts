/**
 * Supabase Auth で Google OAuth を開始するクライアントヘルパ
 *
 * 1 度の同意で以下を一括取得する:
 *   - openid / email / profile       … ログイン認証
 *   - calendar.events                … Maira からカレンダーイベントの作成・編集・削除
 *   - drive.readonly                 … Meet 録画(Drive 保存)の自動取込
 *
 * Maira の方針:
 *   ・「Google でログイン」と「Google を連携」を 1 回の同意で完結させる(分けない)
 *   ・refresh_token を確実にもらうため access_type=offline + prompt=consent を強制
 *     ※ Google の仕様で、prompt=consent を付けないと 2 回目以降 refresh_token が来ない
 *   ・redirectTo は /auth/callback に集約。next クエリで「招待トークン」「サインアップ後」
 *     の遷移先を引き継ぐ
 *
 * 戻り値:
 *   ・error → 呼び出し側で UI 表示
 *   ・success → 自動的にリダイレクトが発生する(戻り値からは何もしない)
 */
import { createClient } from "@/lib/supabase/client";

/** signInWithOAuth で Google に要求するスコープ(連結済) */
export const GOOGLE_AUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

export type StartGoogleAuthOptions = {
  /** ログイン / サインアップ完了後の遷移先(相対パス、例 /app, /invite/abc) */
  next?: string;
  /** 招待トークン(渡された場合は next=/invite/[token] を組む) */
  invitationToken?: string;
};

/**
 * Google OAuth を開始する。
 * 成功時は Google の同意画面にブラウザがリダイレクトされるため戻ってこない。
 * 失敗時のみ呼び出し側に error を返す。
 */
export async function startGoogleAuth(
  options: StartGoogleAuthOptions = {},
): Promise<{ error?: string }> {
  const supabase = createClient();
  const next = options.invitationToken
    ? `/invite/${options.invitationToken}`
    : (options.next ?? "/app");

  // 同じオリジンで戻す(本番でも環境変数 NEXT_PUBLIC_SITE_URL に依存させない)
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: GOOGLE_AUTH_SCOPES,
      // access_type=offline と prompt=consent をペアで指定して refresh_token を確実に取得する
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
      redirectTo,
    },
  });
  if (error) return { error: error.message };
  return {};
}
