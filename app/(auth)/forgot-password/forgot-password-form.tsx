"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { requestPasswordResetSchema, type RequestPasswordResetInput } from "@/lib/validations/auth";
import { requestPasswordReset } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * パスワード再設定リクエストフォーム
 *
 * 【enumeration 対策】
 *   送信成功後は、入力メールの登録有無にかかわらず常に同じ完了画面を出す。
 *   ボタンを押した直後の体験を均質化することで、
 *   「このメールはこのサービスに登録されているか?」を当てられないようにする。
 *   サーバー側 Server Action も常に { success: true } を返す設計。
 */
export function ForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
  });

  const onSubmit = (data: RequestPasswordResetInput) => {
    startTransition(async () => {
      // requestPasswordReset は常に { success: true } を返す(enumeration 対策)。
      // ここで成否を分岐させない。
      await requestPasswordReset(data.email);
      setSubmitted(true);
    });
  };

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">パスワードの再設定</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            登録メールアドレスに再設定用のリンクをお送りします
          </p>
        </div>

        {submitted ? (
          <div className="bg-card space-y-4 rounded-lg border p-6">
            <Alert>
              <AlertDescription>
                入力されたメールアドレスが登録されている場合、パスワード再設定用のリンクを送信しました。
                メールをご確認ください。
              </AlertDescription>
            </Alert>
            <p className="text-muted-foreground text-xs">
              数分待ってもメールが届かない場合は、迷惑メールフォルダをご確認のうえ、
              再度お試しください。
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="bg-card space-y-4 rounded-lg border p-6"
          >
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                {...register("email")}
                disabled={isPending}
              />
              {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "送信中..." : "再設定リンクを送信"}
            </Button>
          </form>
        )}

        <p className="text-muted-foreground text-center text-sm">
          <Link href="/login" className="text-foreground font-medium underline">
            ログインに戻る
          </Link>
        </p>
      </div>
    </main>
  );
}
