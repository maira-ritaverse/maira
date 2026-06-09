import { ResetPasswordForm } from "./reset-password-form";

/**
 * パスワード再設定(新パスワード入力)ページ(Server Component)
 *
 * 動線:
 *   メール内リンク → /auth/callback?code=xxx&next=/auth/reset-password
 *   → callback が code をセッションに交換 → ここに着地
 *
 * セッションが立った状態で着地するため、middleware の
 * 「/auth 配下 + ログイン済み → /app」ルールに引っかかる。
 * lib/supabase/middleware.ts 側で /auth/reset-password を素通しにしている。
 *
 * セッションの実在チェックは Client から呼ぶ updatePassword Server Action 側で行う
 * (リンク失効時は明示的にエラーメッセージで誘導)。
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
