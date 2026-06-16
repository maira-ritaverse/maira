"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import { signup } from "@/app/auth/actions";
import { GoogleSignInButton } from "@/components/features/auth/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OrganizationRole } from "@/lib/organizations/types";

const roleLabel: Record<OrganizationRole, string> = {
  admin: "管理者",
  advisor: "アドバイザー",
};

type InvitationContext = {
  token: string;
  email: string;
  organizationName: string;
  role: OrganizationRole;
};

type Props = {
  /**
   * 招待トークン経由のサインアップであれば、招待行から取り出した
   * 「信頼できる」コンテキスト。null の場合は通常の求職者向けサインアップ。
   * email は招待のものに固定(readonly)し、フォーム側で書き換え不可。
   */
  invitation: InvitationContext | null;
};

export function SignupForm({ invitation }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: invitation
      ? {
          email: invitation.email,
          invitationToken: invitation.token,
        }
      : undefined,
  });

  const onSubmit = async (data: SignupInput) => {
    setIsPending(true);
    setServerError(null);

    // 招待経由なら email は招待のものに必ず差し替え(クライアント改ざん対策)
    // invitationToken は招待 context にあるものを使う。
    const payload: SignupInput = invitation
      ? {
          ...data,
          email: invitation.email,
          invitationToken: invitation.token,
        }
      : { ...data, invitationToken: undefined };

    const result = await signup(payload);

    if (result.error) {
      setServerError(result.error);
      setIsPending(false);
      return;
    }

    if (result.success) {
      router.push("/verify-email");
    }
  };

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">
            {invitation ? "招待を受けて登録" : "Mairaを始める"}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {invitation
              ? `${invitation.organizationName} に ${roleLabel[invitation.role]} として参加します`
              : "あなただけのAI転職エージェント"}
          </p>
        </div>

        {invitation && (
          <Alert>
            <AlertDescription>
              招待メールアドレス <span className="font-medium">{invitation.email}</span>{" "}
              で登録します。メールアドレスは変更できません。
            </AlertDescription>
          </Alert>
        )}

        <div className="bg-card space-y-4 rounded-lg border p-6">
          {/* Google で登録(優先導線、招待トークンも引き継ぐ) */}
          <GoogleSignInButton
            label={invitation ? "Google で登録(招待)" : "Google で登録"}
            invitationToken={invitation?.token}
          />

          {/* or 区切り */}
          <div className="flex items-center gap-3">
            <div className="bg-border h-px flex-1" />
            <span className="text-muted-foreground text-xs">または</span>
            <div className="bg-border h-px flex-1" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                type="text"
                placeholder="例: 太郎"
                {...register("displayName")}
                disabled={isPending}
              />
              {errors.displayName && (
                <p className="text-sm text-red-600">{errors.displayName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                {...register("email")}
                // 招待経由は招待メール固定(変更不可)
                readOnly={!!invitation}
                disabled={isPending}
                className={invitation ? "bg-muted cursor-not-allowed" : undefined}
              />
              {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                placeholder="8文字以上"
                {...register("password")}
                disabled={isPending}
              />
              {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
            </div>

            {/* invitationToken は hidden で保持(Server Action 側でも上書きするが、保険) */}
            {invitation && (
              <input type="hidden" {...register("invitationToken")} value={invitation.token} />
            )}

            {/* 利用規約 + プライバシーポリシー同意(ADR 0006)。
              本人の明示同意がないと登録できないようにする(zod literal(true) で強制)。 */}
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  {...register("agreeToTerms")}
                  disabled={isPending}
                  className="mt-1"
                />
                <span>
                  <Link
                    href="/terms"
                    target="_blank"
                    className="text-foreground font-medium underline"
                  >
                    利用規約
                  </Link>
                  {" と "}
                  <Link
                    href="/privacy"
                    target="_blank"
                    className="text-foreground font-medium underline"
                  >
                    プライバシーポリシー
                  </Link>
                  {" に同意します(必須)"}
                </span>
              </label>
              {errors.agreeToTerms && (
                <p className="text-sm text-red-600">{errors.agreeToTerms.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "登録中..." : invitation ? "登録して参加する" : "新規登録"}
            </Button>
          </form>
        </div>

        <p className="text-muted-foreground text-center text-sm">
          既にアカウントをお持ちですか?{" "}
          <Link
            href={invitation ? `/login?next=/invite/${invitation.token}` : "/login"}
            className="text-foreground font-medium underline"
          >
            ログイン
          </Link>
        </p>
      </div>
    </main>
  );
}
