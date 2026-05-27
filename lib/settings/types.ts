import { z } from "zod";

/**
 * プロフィール更新リクエスト
 *
 * 現状は表示名のみだが、将来的に通知設定など追加するため
 * settings/ ディレクトリに切り出している。
 *
 * 空白のみの表示名は弾く(trim 後の長さで判定)。
 */
export const updateProfileRequestSchema = z.object({
  display_name: z
    .string()
    .min(1, "表示名を入力してください")
    .max(50, "表示名は50文字以内で入力してください")
    .refine((val) => val.trim().length > 0, "空白のみの表示名は使用できません"),
});

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/**
 * パスワード変更リクエスト
 *
 * - max 72 は bcrypt の制限(Supabase Auth が内部で使用)
 * - 確認入力との一致、現在パスワードとの差分を refine でチェック
 * - クライアント・サーバー両方で同じスキーマを使う(zod の単一情報源化)
 */
export const changePasswordRequestSchema = z
  .object({
    current_password: z.string().min(1, "現在のパスワードを入力してください"),
    new_password: z
      .string()
      .min(8, "新パスワードは8文字以上で入力してください")
      .max(72, "新パスワードは72文字以内で入力してください"),
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "確認用パスワードが一致しません",
    path: ["confirm_password"],
  })
  .refine((data) => data.current_password !== data.new_password, {
    message: "新パスワードは現在のパスワードと異なる必要があります",
    path: ["new_password"],
  });

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
