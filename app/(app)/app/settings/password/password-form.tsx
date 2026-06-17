"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordRequestSchema, type ChangePasswordRequest } from "@/lib/settings/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * パスワード変更フォーム
 *
 * profile-form と同じパターン(react-hook-form + zod + useTransition)。
 * 成功時はフォームを完全にクリアし、保存ボタンを再度非活性に戻す。
 *
 * autoComplete 属性はブラウザのパスワードマネージャ用に推奨値を設定:
 * - current-password:現パスワード欄
 * - new-password:新パスワード欄(確認欄も含む)
 */
export function PasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(changePasswordRequestSchema),
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  });

  const onSubmit = (data: ChangePasswordRequest) => {
    startTransition(async () => {
      setServerError(null);
      setSuccessMessage(null);
      try {
        const response = await fetch("/api/settings/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errData = (await response.json()) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "Change failed");
        }

        setSuccessMessage("パスワードを変更しました");
        // 平文パスワードを DOM に残さないよう完全リセット
        reset({
          current_password: "",
          new_password: "",
          confirm_password: "",
        });
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>エラー: {serverError}</AlertDescription>
          </Alert>
        )}
        {successMessage && (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="current_password">
            現在のパスワード <span className="text-red-600">*</span>
          </Label>
          <Input
            id="current_password"
            type="password"
            {...register("current_password")}
            disabled={isPending}
            autoComplete="current-password"
          />
          {errors.current_password && (
            <p className="text-sm text-red-600">{errors.current_password.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="new_password">
            新しいパスワード <span className="text-red-600">*</span>
          </Label>
          <Input
            id="new_password"
            type="password"
            {...register("new_password")}
            disabled={isPending}
            autoComplete="new-password"
          />
          {errors.new_password && (
            <p className="text-sm text-red-600">{errors.new_password.message}</p>
          )}
          <p className="text-muted-foreground text-xs">8文字以上で入力してください</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm_password">
            新しいパスワード(確認) <span className="text-red-600">*</span>
          </Label>
          <Input
            id="confirm_password"
            type="password"
            {...register("confirm_password")}
            disabled={isPending}
            autoComplete="new-password"
          />
          {errors.confirm_password && (
            <p className="text-sm text-red-600">{errors.confirm_password.message}</p>
          )}
        </div>

        <Button type="submit" disabled={isPending || !isDirty} className="w-full">
          {isPending ? "変更中..." : "パスワードを変更"}
        </Button>
      </form>
    </Card>
  );
}
