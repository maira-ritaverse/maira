"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  createClientRequestSchema,
  type CreateClientRequest,
  clientStatusLabels,
} from "@/lib/clients/types";

// zod スキーマで status に .default() を付けているため、入力型(default 前)と
// 出力型(default 適用後)が一致しない。useForm の入出力ジェネリクスを分けないと
// resolver の型整合が取れないので、Input は z.input、Output は CreateClientRequest を使う。
type CreateClientFormInput = z.input<typeof createClientRequestSchema>;
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * クライアント新規登録フォーム
 *
 * 既存の ApplicationForm と同じパターン(react-hook-form + zodResolver + useTransition)。
 * 登録成功時は詳細画面へ遷移する。
 */
export function ClientForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateClientFormInput, unknown, CreateClientRequest>({
    resolver: zodResolver(createClientRequestSchema),
    defaultValues: {
      name: "",
      name_kana: "",
      email: "",
      phone: "",
      status: "initial_meeting",
      notes: "",
      entry_site: "",
      email_distribution_enabled: true,
    },
  });

  const onSubmit: SubmitHandler<CreateClientRequest> = (data) => {
    startTransition(async () => {
      setServerError(null);
      try {
        const response = await fetch("/api/agency/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const errData = (await response.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "登録に失敗しました");
        }
        const result = (await response.json()) as { id: string };
        router.push(`/agency/clients/${result.id}`);
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

        <div className="space-y-2">
          <Label htmlFor="name">
            氏名 <span className="text-red-600">*</span>
          </Label>
          <Input id="name" {...register("name")} disabled={isPending} placeholder="例:山田 太郎" />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="name_kana">氏名カナ</Label>
          <Input
            id="name_kana"
            {...register("name_kana")}
            disabled={isPending}
            placeholder="例:ヤマダ タロウ"
            autoComplete="off"
          />
          {errors.name_kana && <p className="text-sm text-red-600">{errors.name_kana.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">メールアドレス</Label>
          <Input
            id="email"
            type="email"
            {...register("email")}
            disabled={isPending}
            placeholder="例:yamada@example.com"
          />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          <p className="text-muted-foreground text-xs">
            任意入力。登録しておくと招待メール送信や、求職者が同じメールで Maira に
            登録した際の自動連携に使えます。LINE 経由の顧客等で未取得なら空欄で OK。
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
            rows={4}
            placeholder="面談メモ、希望条件など"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          {errors.notes && <p className="text-sm text-red-600">{errors.notes.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="entry_site">エントリーサイト</Label>
          <Input
            id="entry_site"
            {...register("entry_site")}
            disabled={isPending}
            placeholder="例:リクナビ、ビズリーチ、自社サイト"
          />
          <p className="text-muted-foreground text-xs">
            集計・チャネル分析用。後から編集画面で追加することもできます。
          </p>
          {errors.entry_site && <p className="text-sm text-red-600">{errors.entry_site.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email_distribution_enabled" className="flex items-center gap-2">
            <input
              id="email_distribution_enabled"
              type="checkbox"
              {...register("email_distribution_enabled")}
              disabled={isPending}
              className="size-4"
            />
            <span>MA 自動配信を許可する</span>
          </Label>
          <p className="text-muted-foreground text-xs">
            初期値は「許可」。配信を望まない求職者の場合はチェックを外してください。
          </p>
        </div>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "登録中..." : "登録する"}
        </Button>
      </form>
    </Card>
  );
}
