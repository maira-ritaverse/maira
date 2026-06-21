"use client";

import { CheckCircle2, FileText } from "lucide-react";
import { useState } from "react";

/**
 * 資料 請求 (リード 獲得) フォーム
 *
 * LP の CTA セクション 用。 POST /api/marketing/lead-request に 送信。
 * 成功 後 は 「ありがとう」 メッセージ + メール 確認 を 促す 表示 に 切替え。
 *
 * 簡易 スパム 防御: honeypot (= bot が 自動 入力 する hidden フィールド)。
 */
type Props = {
  /** ヘッダー / CTA セクション など 配色 に 応じて 色 を 切り替える */
  variant?: "light" | "dark";
};

type Status = "idle" | "submitting" | "success" | "error";

export function LeadRequestForm({ variant = "light" }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const labelClass =
    variant === "dark" ? "text-xs font-medium text-white/80" : "text-xs font-medium text-slate-700";
  const inputClass =
    "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30";
  const wrapperClass = variant === "dark" ? "text-white" : "text-slate-900";

  if (status === "success") {
    return (
      <div
        className={`${wrapperClass} space-y-3 rounded-lg border border-emerald-300/40 bg-emerald-50/90 p-6 text-slate-900`}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-6 text-emerald-600" aria-hidden />
          <p className="text-lg font-semibold">資料請求を受け付けました</p>
        </div>
        <p className="text-sm leading-relaxed text-slate-700">
          1営業日以内に担当から資料(PDF)と簡単なご紹介をお送りします。ご入力のメールアドレスを受信設定にご注意ください。
        </p>
      </div>
    );
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      companyName: String(data.get("companyName") ?? ""),
      contactName: String(data.get("contactName") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      source: String(data.get("source") ?? ""),
      notes: String(data.get("notes") ?? ""),
      website: String(data.get("website") ?? ""), // honeypot
    };
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/marketing/lead-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "送信 に 失敗 しました");
    }
  };

  return (
    <form onSubmit={submit} className={`${wrapperClass} space-y-3`}>
      {/* honeypot: 通常 ユーザー は 触らない */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        style={{
          position: "absolute",
          left: "-10000px",
          width: 1,
          height: 1,
          opacity: 0,
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>
            会社名 <span className="text-red-500">*</span>
          </span>
          <input
            name="companyName"
            required
            maxLength={120}
            placeholder="株式会社サンプル"
            className={inputClass}
            disabled={status === "submitting"}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>
            ご担当者名 <span className="text-red-500">*</span>
          </span>
          <input
            name="contactName"
            required
            maxLength={80}
            placeholder="山田 太郎"
            className={inputClass}
            disabled={status === "submitting"}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>
            メール <span className="text-red-500">*</span>
          </span>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="taro@example.com"
            className={inputClass}
            disabled={status === "submitting"}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>電話(任意)</span>
          <input
            name="phone"
            maxLength={40}
            placeholder="03-1234-5678"
            className={inputClass}
            disabled={status === "submitting"}
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className={labelClass}>何で知りましたか?(任意)</span>
        <input
          name="source"
          maxLength={80}
          placeholder="X / 知人紹介 / 検索 など"
          className={inputClass}
          disabled={status === "submitting"}
        />
      </label>

      <label className="block space-y-1">
        <span className={labelClass}>ご要望・ご質問(任意)</span>
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          placeholder="気になる機能、試したい内容 など"
          className={`${inputClass} resize-y`}
          disabled={status === "submitting"}
        />
      </label>

      {status === "error" && errorMessage && (
        <p className="text-sm text-red-300" role="alert">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-emerald-600 disabled:opacity-60"
      >
        <FileText className="size-4" aria-hidden />
        {status === "submitting" ? "送信中…" : "資料を請求する"}
      </button>

      <p
        className={`${variant === "dark" ? "text-white/60" : "text-slate-500"} text-[11px] leading-relaxed`}
      >
        送信すると、1営業日以内に担当から資料PDFをお送りします。ご入力内容は
        <a href="/privacy" className="underline">
          プライバシーポリシー
        </a>
        に沿って取り扱います。
      </p>
    </form>
  );
}
