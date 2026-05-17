import { createClient } from "@/lib/supabase/server";

/**
 * Supabase疎通確認用ページ
 * - 環境変数が設定されているか
 * - Supabaseに接続できるか
 * - 認証ステータスが取得できるか
 *
 * 注意:このページは開発確認用。本番リリース前に削除すること
 */
export default async function TestSupabasePage() {
  // 環境変数の存在チェック
  const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Supabaseに接続してgetUser()を試す
  let connectionStatus: "ok" | "error" = "ok";
  let connectionError: string | null = null;
  let userInfo: string = "未ログイン(これは正常)";

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      // AuthSessionMissingErrorは「未ログイン」を意味するので正常
      if (error.message.includes("session")) {
        userInfo = "未ログイン(これは正常)";
      } else {
        connectionStatus = "error";
        connectionError = error.message;
      }
    } else if (data.user) {
      userInfo = `ログイン中: ${data.user.email ?? "(メール不明)"}`;
    }
  } catch (e) {
    connectionStatus = "error";
    connectionError = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-3xl font-bold">Supabase 疎通テスト</h1>

        <div className="bg-card space-y-4 rounded-lg border p-6">
          <div>
            <h2 className="mb-2 font-semibold">環境変数チェック</h2>
            <ul className="space-y-1 text-sm">
              <li>NEXT_PUBLIC_SUPABASE_URL: {hasUrl ? "✅ 設定済み" : "❌ 未設定"}</li>
              <li>NEXT_PUBLIC_SUPABASE_ANON_KEY: {hasAnonKey ? "✅ 設定済み" : "❌ 未設定"}</li>
              <li>SUPABASE_SERVICE_ROLE_KEY: {hasServiceKey ? "✅ 設定済み" : "❌ 未設定"}</li>
            </ul>
          </div>

          <div>
            <h2 className="mb-2 font-semibold">接続テスト</h2>
            <p className="text-sm">
              ステータス: {connectionStatus === "ok" ? "✅ 接続OK" : "❌ 接続エラー"}
            </p>
            {connectionError && (
              <p className="mt-2 text-sm text-red-600">エラー: {connectionError}</p>
            )}
          </div>

          <div>
            <h2 className="mb-2 font-semibold">認証ステータス</h2>
            <p className="text-sm">{userInfo}</p>
          </div>
        </div>

        <p className="text-muted-foreground mt-6 text-xs">
          ※このページは開発確認用です。本番リリース前に削除します
        </p>
      </div>
    </main>
  );
}
