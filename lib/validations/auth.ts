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
