"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import Link from "next/link";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { updatePassword } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * 新パスワード入力フォーム(リセットフロー専用)
 *
 * - 平文 PW は成功時に reset() で完全クリア(DOM に残さない)
 * - autoComplete="new-password" を明示
 * - セッション無効(リンク失効・直接アクセス)の場合は専用 UI で
 *   /forgot-password への再リクエスト導線を出す
 */
export function ResetPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      new_password: "",
      confirm_password: "",
    },
  });

  const onSubmit = (data: ResetPasswordInput) => {
    startTransition(async () => {
      setServerError(null);
      const result = await updatePassword(data.new_password);

      if (result.error) {
        // Server Action 側で「セッションが無効です」を返す日本語文言で判定。
        // SDK 内部の error 種別をクライアントに漏らさないため、サーバー側の文言を信頼境界として扱う。
        if (result.error.includes("セッション")) {
          setSessionInvalid(true);
        } else {
          setServerError(result.error);
        }
        return;
      }

      // 平文 PW を DOM に残さないよう完全リセット
      reset({ new_password: "", confirm_password: "" });
      setSuccess(true);
    });
  };

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/icon-192.png" alt="" width={64} height={64} priority className="size-16" />
          <h1 className="text-3xl font-bold">新しいパスワードを設定</h1>
        </div>

        {sessionInvalid ? (
          <div className="bg-card space-y-4 rounded-lg border p-6">
            <Alert variant="destructive">
              <AlertDescription>
                リンクの有効期限が切れているか無効です。お手数ですが再度パスワード再設定をやり直してください。
              </AlertDescription>
            </Alert>
            <Button className="w-full" render={<Link href="/forgot-password" />}>
              パスワード再設定をやり直す
            </Button>
          </div>
        ) : success ? (
          <div className="bg-card space-y-4 rounded-lg border p-6">
            <Alert>
              <AlertDescription>
                パスワードを変更しました。新しいパスワードでログインしてください。
              </AlertDescription>
            </Alert>
            <Button className="w-full" render={<Link href="/login" />}>
              ログインへ
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="bg-card space-y-4 rounded-lg border p-6"
          >
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="new_password">
                新しいパスワード <span className="text-red-600">*</span>
              </Label>
              <PasswordInput
                id="new_password"
                autoComplete="new-password"
                {...register("new_password")}
                disabled={isPending}
              />
              {errors.new_password && (
                <p className="text-sm text-red-600">{errors.new_password.message}</p>
              )}
              <p className="text-muted-foreground text-xs">12文字以上で入力してください</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm_password">
                新しいパスワード(確認) <span className="text-red-600">*</span>
              </Label>
              <PasswordInput
                id="confirm_password"
                autoComplete="new-password"
                {...register("confirm_password")}
                disabled={isPending}
              />
              {errors.confirm_password && (
                <p className="text-sm text-red-600">{errors.confirm_password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "更新中..." : "パスワードを更新"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
