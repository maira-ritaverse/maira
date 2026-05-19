"use client";

import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { login } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * useSearchParams() を使うため、Next.js 15+ では静的レンダリング時に
 * Suspense境界で包む必要がある。ページ本体は内側のコンポーネントに分離する。
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(
    errorParam === "auth_callback_failed" ? "認証に失敗しました。もう一度お試しください。" : null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setIsPending(true);
    setServerError(null);

    const result = await login(data);

    // 成功時はlogin Server Action内でredirectされるため、ここに到達するのはエラー時のみ
    if (result?.error) {
      setServerError(result.error);
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-card space-y-4 rounded-lg border p-6">
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">メールアドレス</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          {...register("email")}
          disabled={isPending}
        />
        {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">パスワード</Label>
        <Input id="password" type="password" {...register("password")} disabled={isPending} />
        {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "ログイン中..." : "ログイン"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Mairaにログイン</h1>
        </div>

        <Suspense
          fallback={
            <div className="bg-card rounded-lg border p-6 text-center text-sm">読み込み中...</div>
          }
        >
          <LoginForm />
        </Suspense>

        <p className="text-muted-foreground text-center text-sm">
          アカウントをお持ちでないですか?{" "}
          <Link href="/auth/signup" className="text-foreground font-medium underline">
            新規登録
          </Link>
        </p>
      </div>
    </main>
  );
}
