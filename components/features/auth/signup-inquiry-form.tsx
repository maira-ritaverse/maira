"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 新規導入のお問い合わせフォーム(ログイン画面に展開式で配置)。
 *
 * BtoBtoC 化に伴い「新規会員登録」は admin 側からの招待のみになったため、
 * ログイン画面に「興味があるけどまだ契約していない人」の受け口を置く。
 *
 * - 送信先は既存の /api/contact(LP 問い合わせフォームと同じエンドポイント)
 *   → contact_messages テーブルに保存され、運営者の問い合わせ受信箱に届く
 * - 「[新規導入] 」のプレフィックスを message に自動付与し、受信箱で分類しやすくする
 * - shadcn UI でログイン画面の世界観に揃える(LP の素のフィールドとは別系)
 */

const inquirySchema = z.object({
  company: z
    .string()
    .min(1, "会社名を入力してください")
    .max(100, "会社名は 100 文字以内で入力してください"),
  name: z
    .string()
    .min(1, "お名前を入力してください")
    .max(50, "お名前は 50 文字以内で入力してください"),
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .email("メールアドレスの形式が正しくありません"),
  message: z
    .string()
    .min(10, "ご質問・ご要望は 10 文字以上で入力してください")
    .max(1900, "ご質問・ご要望は 1900 文字以内で入力してください"),
});

type InquiryValues = z.infer<typeof inquirySchema>;

type Status = "idle" | "sending" | "sent" | "error";

const MESSAGE_PREFIX = "[新規導入のお問い合わせ] ";

export function SignupInquiryForm() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<Status>("idle");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InquiryValues>({
    resolver: zodResolver(inquirySchema),
    defaultValues: { company: "", name: "", email: "", message: "" },
  });

  const onSubmit = async (values: InquiryValues) => {
    if (status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...values,
          // 運営者が受信箱で分類しやすいよう、本文先頭にプレフィックスを付ける
          message: `${MESSAGE_PREFIX}${values.message}`,
        }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("sent");
      reset();
    } catch {
      // ネットワーク断などは汎用メッセージ
      setStatus("error");
    }
  };

  // 折りたたみ状態:「初めての方はこちら」だけ表示
  if (!expanded) {
    return (
      <div className="bg-card space-y-2 rounded-lg border p-4 text-center text-sm">
        <p className="text-muted-foreground text-xs">まだアカウントをお持ちでない企業様</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
          新規導入のお問い合わせ
        </Button>
      </div>
    );
  }

  // 送信完了:お礼メッセージ
  if (status === "sent") {
    return (
      <div className="bg-card space-y-3 rounded-lg border p-6 text-center text-sm">
        <div className="flex justify-center text-emerald-600 dark:text-emerald-400">
          <Check className="h-8 w-8" />
        </div>
        <p className="font-semibold">お問い合わせを受け付けました</p>
        <p className="text-muted-foreground text-xs">
          内容を確認のうえ、担当よりご連絡差し上げます。
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setExpanded(false);
            setStatus("idle");
          }}
        >
          閉じる
        </Button>
      </div>
    );
  }

  // 展開状態:フォーム
  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="bg-card space-y-4 rounded-lg border p-6"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">新規導入のお問い合わせ</h2>
          <p className="text-muted-foreground text-xs">
            ご検討中の企業様向け。担当者よりご連絡差し上げます。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="閉じる"
          onClick={() => {
            setExpanded(false);
            setStatus("idle");
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {status === "error" && (
        <Alert variant="destructive">
          <AlertDescription>送信に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="inq-company">
          会社名 <span className="text-red-600">*</span>
        </Label>
        <Input
          id="inq-company"
          placeholder="株式会社○○"
          autoComplete="organization"
          disabled={status === "sending"}
          {...register("company")}
        />
        {errors.company && <p className="text-sm text-red-600">{errors.company.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="inq-name">
          ご担当者名 <span className="text-red-600">*</span>
        </Label>
        <Input
          id="inq-name"
          placeholder="山田 太郎"
          autoComplete="name"
          disabled={status === "sending"}
          {...register("name")}
        />
        {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="inq-email">
          メールアドレス <span className="text-red-600">*</span>
        </Label>
        <Input
          id="inq-email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          disabled={status === "sending"}
          {...register("email")}
        />
        {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="inq-message">
          ご質問・ご要望 <span className="text-red-600">*</span>
        </Label>
        <Textarea
          id="inq-message"
          rows={4}
          placeholder="想定する利用人数、ご質問、デモのご希望などをお書きください。"
          maxLength={1900}
          disabled={status === "sending"}
          {...register("message")}
        />
        {errors.message && <p className="text-sm text-red-600">{errors.message.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={status === "sending"}>
        {status === "sending" ? "送信中…" : "送信する"}
      </Button>
    </form>
  );
}
