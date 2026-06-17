"use client";

import { Check, Info, X } from "lucide-react";

import { useToast } from "@/lib/admin/toast/store";

/**
 * トースト表示コンテナ(画面右下に積み上げ)。
 *
 * - 自動消去はストア側で setTimeout
 * - ユーザクリック / ✕ で手動 dismiss
 * - role="status" + aria-live="polite" でスクリーンリーダーにも対応
 * - 上に新しい順、下に古い順(積み上げ)
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-300 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} kind={t.kind} message={t.message} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  kind,
  message,
  onDismiss,
}: {
  kind: "success" | "error" | "info";
  message: string;
  onDismiss: () => void;
}) {
  const cls = {
    success:
      "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-100",
    error:
      "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/80 dark:text-red-100",
    info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/80 dark:text-blue-100",
  }[kind];
  const IconComponent = { success: Check, error: X, info: Info }[kind];

  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg ${cls}`}>
      <span aria-hidden className="mt-0.5">
        <IconComponent className="h-4 w-4" />
      </span>
      <p className="flex-1 leading-snug">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="閉じる"
        className="text-current opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
