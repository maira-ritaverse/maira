"use client";

import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { z } from "zod";

/**
 * エージェント向けLPの問い合わせフォーム。
 *
 * - 送信処理(Resend 連携)は別タスクで実装する。
 *   ここでは UI とバリデーション(react-hook-form + zod)までを整える。
 * - 送信ハンドラは現状スタブで、API リクエストの代わりに 600ms 待って成功扱いにする。
 *   API 接続時は onSubmit 内の Promise を fetch("/api/contact", …) に差し替えれば足りる。
 * - スタイルは LP の世界観(藍基調 + 藤色アクセント)に揃える。
 *   業務UI(shadcn)とは別レイヤーなので、shadcn コンポーネントは使わず素のフィールドで構成。
 */

const contactSchema = z.object({
  company: z
    .string()
    .min(1, "会社名を入力してください")
    .max(100, "会社名は100文字以内で入力してください"),
  name: z
    .string()
    .min(1, "お名前を入力してください")
    .max(50, "お名前は50文字以内で入力してください"),
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .email("メールアドレスの形式が正しくありません"),
  message: z
    .string()
    .min(10, "お問い合わせ内容は10文字以上で入力してください")
    .max(2000, "お問い合わせ内容は2000文字以内で入力してください"),
});

type ContactFormValues = z.infer<typeof contactSchema>;

type SubmitStatus = "idle" | "sending" | "sent" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<SubmitStatus>("idle");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { company: "", name: "", email: "", message: "" },
  });

  const onSubmit = async (_values: ContactFormValues) => {
    setStatus("sending");
    try {
      // 送信処理(Resend 連携)は別タスクで実装する。
      // 今は UI とバリデーション検証用のスタブとして、600ms 待って成功扱いにする。
      // API 接続時はこの Promise を fetch("/api/contact", …) に差し替える。
      await new Promise((resolve) => setTimeout(resolve, 600));
      setStatus("sent");
      reset();
    } catch (error) {
      console.error("[marketing/contact] submit error:", error);
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div className="flex flex-col items-start gap-6 rounded-2xl border border-[color:var(--lp-line)] bg-[color:var(--lp-bg)] p-10 sm:p-12">
        <div className="flex size-12 items-center justify-center rounded-full bg-[color:var(--lp-fuji)]/12 text-[color:var(--lp-fuji)]">
          <CheckCircle2 className="size-6" />
        </div>
        <div className="space-y-3">
          <h3 className="lp-serif-ja text-[1.3rem] font-medium text-[color:var(--lp-ink)]">
            お問い合わせを受け付けました
          </h3>
          <p className="text-[0.95rem] text-[color:var(--lp-ink-soft)]">
            内容を確認のうえ、担当よりご連絡差し上げます。
            <br />
            お待たせする場合がございますこと、ご了承ください。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="text-[0.85rem] text-[color:var(--lp-fuji)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)]"
        >
          別のお問い合わせを送る
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-7 rounded-2xl border border-[color:var(--lp-line)] bg-[color:var(--lp-bg)] p-8 sm:p-10"
    >
      <Field
        id="contact-company"
        label="会社名"
        required
        placeholder="株式会社○○"
        autoComplete="organization"
        error={errors.company?.message}
        {...register("company")}
      />
      <Field
        id="contact-name"
        label="お名前"
        required
        placeholder="山田 太郎"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />
      <Field
        id="contact-email"
        label="メールアドレス"
        required
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <TextareaField
        id="contact-message"
        label="お問い合わせ内容"
        required
        rows={6}
        placeholder="導入のご相談、デモのご希望、料金のお見積もりなど、お気軽にお書きください。"
        error={errors.message?.message}
        {...register("message")}
      />

      {status === "error" ? (
        <p role="alert" className="text-[0.85rem] text-red-600">
          送信に失敗しました。時間をおいて再度お試しください。
        </p>
      ) : null}

      <div className="flex items-center justify-between pt-2">
        <p className="text-[0.75rem] text-[color:var(--lp-ink-faint)]">
          送信内容は SSL で保護されます
        </p>
        <button
          type="submit"
          disabled={status === "sending"}
          className="group inline-flex items-center gap-3 rounded-full bg-[color:var(--lp-navy)] px-7 py-3 text-[0.92rem] text-white transition-all hover:bg-[color:var(--lp-navy-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--lp-fuji)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "sending" ? "送信中..." : "送信する"}
          {status === "sending" ? null : (
            <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          )}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* 内部のフィールドプリミティブ                                       */
/* shadcn は使わず、LP の世界観に合わせて素のフィールドで構成する     */
/* ------------------------------------------------------------------ */

type FieldBaseProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
};

type FieldProps = FieldBaseProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id">;

const Field = React.forwardRef<HTMLInputElement, FieldProps>(function Field(
  { id, label, required, error, className, ...props },
  ref,
) {
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel id={id} label={label} required={required} />
      <input
        id={id}
        ref={ref}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={
          "w-full border-b border-[color:var(--lp-line-strong)] bg-transparent px-1 py-3 text-[0.95rem] text-[color:var(--lp-ink)] transition-colors outline-none placeholder:text-[color:var(--lp-ink-faint)]/70 hover:border-[color:var(--lp-ink-soft)] focus:border-[color:var(--lp-fuji)] aria-[invalid=true]:border-red-500 " +
          (className ?? "")
        }
        {...props}
      />
      <FieldError id={id} error={error} />
    </div>
  );
});

type TextareaFieldProps = FieldBaseProps &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

const TextareaField = React.forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField({ id, label, required, error, className, ...props }, ref) {
    return (
      <div className="flex flex-col gap-2">
        <FieldLabel id={id} label={label} required={required} />
        <textarea
          id={id}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={
            "w-full resize-y border-b border-[color:var(--lp-line-strong)] bg-transparent px-1 py-3 text-[0.95rem] leading-[1.85] text-[color:var(--lp-ink)] transition-colors outline-none placeholder:text-[color:var(--lp-ink-faint)]/70 hover:border-[color:var(--lp-ink-soft)] focus:border-[color:var(--lp-fuji)] aria-[invalid=true]:border-red-500 " +
            (className ?? "")
          }
          {...props}
        />
        <FieldError id={id} error={error} />
      </div>
    );
  },
);

function FieldLabel({ id, label, required }: { id: string; label: string; required?: boolean }) {
  return (
    <label
      htmlFor={id}
      className="lp-serif-en flex items-center gap-2 text-[0.7rem] tracking-[0.3em] text-[color:var(--lp-ink-faint)] uppercase"
    >
      <span>{label}</span>
      {required ? <span className="text-[color:var(--lp-fuji)]">*</span> : null}
    </label>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-[0.8rem] text-red-600">
      {error}
    </p>
  );
}
