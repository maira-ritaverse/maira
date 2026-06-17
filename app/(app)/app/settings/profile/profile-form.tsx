"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfileRequestSchema, type UpdateProfileRequest } from "@/lib/settings/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * プロフィール編集フォーム
 *
 * application-form と同じパターン(react-hook-form + zod + useTransition)。
 * 保存後は router.refresh() で Server Component を再評価し、
 * ヘッダーの表示名などへ即時反映させる。
 *
 * メールアドレスは現時点では変更不可(Supabase Auth の確認フローが必要なため、
 * 仕様確定後に Phase 2 以降で対応)。
 */

type Props = {
  initialDisplayName: string;
  email: string;
};

export function ProfileForm({ initialDisplayName, email }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<UpdateProfileRequest>({
    resolver: zodResolver(updateProfileRequestSchema),
    defaultValues: {
      display_name: initialDisplayName,
    },
  });

  const onSubmit = (data: UpdateProfileRequest) => {
    startTransition(async () => {
      setServerError(null);
      setSuccessMessage(null);
      try {
        const response = await fetch("/api/settings/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errData = (await response.json()) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "Save failed");
        }

        // 保存成功後は trim 済みの値で isDirty を初期化し直す
        // (保存ボタンを再度非活性に戻すため)
        const saved = data.display_name.trim();
        reset({ display_name: saved });
        setSuccessMessage("プロフィールを更新しました");
        router.refresh();
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
          <Label htmlFor="email">メールアドレス</Label>
          <Input id="email" type="email" value={email} disabled className="bg-muted" />
          <p className="text-muted-foreground text-xs">メールアドレスは現時点では変更できません</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="display_name">
            表示名 <span className="text-red-600">*</span>
          </Label>
          <Input
            id="display_name"
            {...register("display_name")}
            disabled={isPending}
            placeholder="例:山田太郎"
            maxLength={50}
          />
          {errors.display_name && (
            <p className="text-sm text-red-600">{errors.display_name.message}</p>
          )}
          <p className="text-muted-foreground text-xs">アプリ内で表示される名前です(1-50文字)</p>
        </div>

        <Button type="submit" disabled={isPending || !isDirty} className="w-full">
          {isPending ? "保存中..." : "保存"}
        </Button>
      </form>
    </Card>
  );
}
