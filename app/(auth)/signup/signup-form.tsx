"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import { signup } from "@/app/auth/actions";
import { GoogleSignInButton } from "@/components/features/auth/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
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

type ClientInvitationContext = {
  token: string;
  email: string;
  organizationName: string;
  seekerName: string;
};

type Props = {
  /**
   * エージェントメンバー招待の場合の信頼コンテキスト(null = 招待なし or 求職者招待)。
   * email は招待のものに固定し、フォーム側で書き換え不可。
   */
  invitation: InvitationContext | null;
  /**
   * 求職者(client_record)招待の場合の信頼コンテキスト(null = 招待なし or メンバー招待)。
   * email は招待のものに固定し、フォーム側で書き換え不可。
   * 受諾は callback の accept_client_invitation RPC が email 一致で自動実行する
   * (Server Action 側で /invite/[token] に next 飛ばさない)。
   */
  clientInvitation: ClientInvitationContext | null;
};

export function SignupForm({ invitation, clientInvitation }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // 招待の種類に応じて 初期値 / 表示文言を切り替える。同時に両方は来ない前提。
  const lockedEmail = invitation?.email ?? clientInvitation?.email;
  const lockedToken = invitation?.token;
  const lockedClientToken = clientInvitation?.token;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: lockedEmail,
      invitationToken: lockedToken,
      clientInvitationToken: lockedClientToken,
    },
  });

  const onSubmit = async (data: SignupInput) => {
    setIsPending(true);
    setServerError(null);

    // 招待経由なら email は招待のものに必ず差し替え(クライアント改ざん対策)
    // 同様に token も招待 context のものを使う(hidden の改ざんを上書き)。
    const payload: SignupInput = {
      ...data,
      email: lockedEmail ?? data.email,
      invitationToken: lockedToken,
      clientInvitationToken: lockedClientToken,
    };

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

  const headerTitle = invitation
    ? "招待を受けて登録"
    : clientInvitation
      ? "Maira を始める(招待を受けて)"
      : "Mairaを始める";

  const headerSubtitle = invitation
    ? `${invitation.organizationName} に ${roleLabel[invitation.role]} として参加します`
    : clientInvitation
      ? `${clientInvitation.organizationName} からの招待を受けて Maira を始めます`
      : "あなただけのAI転職エージェント";

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/icon-192.png" alt="" width={64} height={64} priority className="size-16" />
          <div>
            <h1 className="text-3xl font-bold">{headerTitle}</h1>
            <p className="text-muted-foreground mt-2 text-sm">{headerSubtitle}</p>
          </div>
        </div>

        {invitation && (
          <Alert>
            <AlertDescription>
              招待メールアドレス <span className="font-medium">{invitation.email}</span>{" "}
              で登録します。メールアドレスは変更できません。
            </AlertDescription>
          </Alert>
        )}

        {clientInvitation && (
          <Alert>
            <AlertDescription>
              <span className="font-medium">{clientInvitation.organizationName}</span> からの招待で
              <span className="font-medium"> {clientInvitation.email}</span>{" "}
              で登録します。メールアドレスは変更できません。
            </AlertDescription>
          </Alert>
        )}

        <div className="bg-card space-y-4 rounded-lg border p-6">
          {/* Google で登録(優先導線、招待トークンも引き継ぐ) */}
          <GoogleSignInButton
            label={invitation || clientInvitation ? "Google で登録(招待)" : "Google で登録"}
            invitationToken={invitation?.token}
            clientInvitationToken={clientInvitation?.token}
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
                readOnly={!!lockedEmail}
                disabled={isPending}
                className={lockedEmail ? "bg-muted cursor-not-allowed" : undefined}
              />
              {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <PasswordInput
                id="password"
                placeholder="8文字以上"
                autoComplete="new-password"
                {...register("password")}
                disabled={isPending}
              />
              {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
            </div>

            {/* トークンは hidden で保持(Server Action 側でも上書きするが、保険) */}
            {invitation && (
              <input type="hidden" {...register("invitationToken")} value={invitation.token} />
            )}
            {clientInvitation && (
              <input
                type="hidden"
                {...register("clientInvitationToken")}
                value={clientInvitation.token}
              />
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
              {isPending
                ? "登録中..."
                : invitation
                  ? "登録して参加する"
                  : clientInvitation
                    ? "登録して始める"
                    : "新規登録"}
            </Button>
          </form>
        </div>

        <p className="text-muted-foreground text-center text-sm">
          既にアカウントをお持ちですか?{" "}
          <Link
            href={
              invitation
                ? `/login?next=/invite/${invitation.token}`
                : clientInvitation
                  ? `/login?next=/app`
                  : "/login"
            }
            className="text-foreground font-medium underline"
          >
            ログイン
          </Link>
        </p>
      </div>
    </main>
  );
}
