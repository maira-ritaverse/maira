import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * パスワード再設定リクエストページ(Server Component)
 *
 * メールアドレスを入力 → Supabase からリセットリンクのメールを送る画面。
 * フォーム本体は Client コンポーネントに分離(signup と同じ二分割流儀)。
 *
 * 未ログイン前提のページ。/auth 配下にあるので、既ログイン者は
 * middleware により /app へリダイレクトされる。
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
