import { z } from "zod";

/**
 * 新規登録フォームのバリデーション
 */
export const signupSchema = z.object({
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .email("有効なメールアドレスを入力してください"),
  password: z
    .string()
    .min(8, "パスワードは8文字以上で入力してください")
    .max(72, "パスワードは72文字以内で入力してください"),
  displayName: z
    .string()
    .min(1, "表示名を入力してください")
    .max(50, "表示名は50文字以内で入力してください"),
  /**
   * 招待トークン(任意)。
   * 渡された場合、サインアップ → メール確認 → callback で
   * /invite/[token] に戻すために emailRedirectTo に埋め込む。
   * email 自体の正当性チェックは callback 後の RPC で行う。
   */
  invitationToken: z.string().min(1).max(256).optional(),
  /**
   * 利用規約 + プライバシーポリシーへの同意(必須)。
   * ADR 0006(サーバーサイド暗号化への方針確定)により、保管と AI 処理の範囲が
   * プライバシーポリシーに明記されるため、登録時の明示同意を必須化する。
   */
  agreeToTerms: z.literal(true, {
    errorMap: () => ({
      message: "利用規約とプライバシーポリシーへの同意が必要です",
    }),
  }),
});

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * ログインフォームのバリデーション
 */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .email("有効なメールアドレスを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * パスワード再設定リクエストフォームのバリデーション
 *
 * 「パスワードを忘れた」ユーザーがメールアドレスを入力して
 * 再設定リンクを受け取る画面で使用。
 */
export const requestPasswordResetSchema = z.object({
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .email("有効なメールアドレスを入力してください"),
});

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

/**
 * パスワード再設定フォームのバリデーション
 *
 * リセットメールのリンク経由でセッションが立った状態の画面で使用。
 * - max 72 は bcrypt の制限(Supabase Auth が内部で使用)
 * - 確認入力との一致を refine でチェック(不一致時は confirm_password にメッセージ)
 *
 * 注:ログイン中の「パスワード変更」画面と違い、ここでは
 * 「現在のパスワード」「現パスワードとの差分」は要求しない。
 * ユーザーは現パスワードを忘れている前提のフローのため。
 */
export const resetPasswordSchema = z
  .object({
    new_password: z
      .string()
      .min(8, "新パスワードは8文字以上で入力してください")
      .max(72, "新パスワードは72文字以内で入力してください"),
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "確認用パスワードが一致しません",
    path: ["confirm_password"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
