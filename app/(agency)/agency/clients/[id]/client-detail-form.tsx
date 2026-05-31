"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateClientRequestSchema,
  type UpdateClientRequest,
  type ClientRecord,
  clientStatusLabels,
} from "@/lib/clients/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * クライアント詳細編集フォーム
 *
 * new/client-form.tsx とほぼ同じ作りだが、初期値を既存レコードから取り、
 * PATCH /api/agency/clients/[id] を呼ぶ。保存成功時は router.refresh() で再取得。
 *
 * 担当アドバイザー変更は将来のメンバー一覧 UI と一緒に出すため、ここでは出さない
 * (API スキーマには既に assigned_member_id が含まれている)。
 */

type Props = { client: ClientRecord };

export function ClientDetailForm({ client }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateClientRequest>({
    resolver: zodResolver(updateClientRequestSchema),
    defaultValues: {
      name: client.name,
      email: client.email,
      phone: client.phone ?? "",
      status: client.status,
      notes: client.notes ?? "",
    },
  });

  const onSubmit = (data: UpdateClientRequest) => {
    startTransition(async () => {
      setServerError(null);
      setSuccessMessage(null);
      try {
        const response = await fetch(`/api/agency/clients/${client.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const errData = (await response.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "保存に失敗しました");
        }
        setSuccessMessage("保存しました");
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
          <Label htmlFor="name">
            氏名 <span className="text-red-600">*</span>
          </Label>
          <Input id="name" {...register("name")} disabled={isPending} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">
            メールアドレス <span className="text-red-600">*</span>
          </Label>
          <Input id="email" type="email" {...register("email")} disabled={isPending} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          <p className="text-muted-foreground text-xs">
            このメールで求職者がMairaに登録すると、自動的に連携できます
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">電話番号</Label>
          <Input
            id="phone"
            {...register("phone")}
            disabled={isPending}
            placeholder="例:090-1234-5678"
          />
          {errors.phone && <p className="text-sm text-red-600">{errors.phone.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">ステータス</Label>
          <select
            id="status"
            {...register("status")}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {Object.entries(clientStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">メモ</Label>
          <textarea
            id="notes"
            {...register("notes")}
            disabled={isPending}
            rows={6}
            placeholder="面談メモ、希望条件など"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          {errors.notes && <p className="text-sm text-red-600">{errors.notes.message}</p>}
        </div>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "保存中..." : "保存"}
        </Button>
      </form>
    </Card>
  );
}
