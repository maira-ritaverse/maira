"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

export type QuotaInfo = {
  current: number;
  limit: number;
  addon: boolean;
  resetsAt: string;
};

type Props = {
  open: boolean;
  /** 機能名(例:「AI 証明写真」)、UI 上の説明用 */
  featureLabel: string;
  usage: QuotaInfo | null;
  /** Stripe Checkout を呼べる状態か(env が揃っているか) */
  stripeAvailable?: boolean;
  onClose: () => void;
};

/**
 * クォータ超過時に出すモーダル。
 *
 * - 残量・上限・リセット日を出す
 * - 「アドオンを追加して上限拡張」ボタン → Stripe Checkout に遷移
 * - 「閉じる」で消える
 *
 * 既にアドオン契約済みの場合(usage.addon=true)は「来月までお待ちください」を出して
 * Stripe ボタンは出さない(これ以上アップグレードできないため)。
 */
export function QuotaExceededModal({
  open,
  featureLabel,
  usage,
  stripeAvailable = true,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const startCheckout = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ url: string }>("/api/billing/checkout-session", {
        method: "POST",
      });
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  };

  const resetsLabel = usage ? new Date(usage.resetsAt).toLocaleDateString("ja-JP") : "(不明)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="月次上限に到達"
    >
      <div className="bg-background w-full max-w-md space-y-4 rounded-lg border p-5 shadow-lg">
        <div>
          <h2 className="text-lg font-semibold">月次上限に到達しました</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {featureLabel} は基本プランの月次上限が設定されています。
          </p>
        </div>

        {usage && (
          <div className="bg-muted/40 space-y-1 rounded-md p-3 text-xs">
            <div className="flex justify-between">
              <span>今月の利用</span>
              <span className="font-medium">
                {usage.current} / {usage.limit} 回
              </span>
            </div>
            <div className="flex justify-between">
              <span>来月のリセット</span>
              <span>{resetsLabel}</span>
            </div>
            <div className="flex justify-between">
              <span>契約状態</span>
              <span>{usage.addon ? "アドオン契約中" : "基本プラン"}</span>
            </div>
          </div>
        )}

        {usage?.addon ? (
          <p className="text-muted-foreground text-xs">
            すでにアドオン契約中のため、これ以上の拡張はできません。来月のリセットまでお待ちください。
          </p>
        ) : (
          <div className="space-y-2 text-xs">
            <p className="font-medium">アドオン「会議録音 自動連携」を追加すると:</p>
            <ul className="text-muted-foreground ml-4 list-disc">
              <li>AI ヒアリング:月 3 → 50 件</li>
              <li>AI 証明写真:月 5 → 30 回</li>
              <li>AI 求人推薦:月 20 → 200 回</li>
              <li>Zoom / Google Meet の自動取込</li>
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50/60 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            閉じる
          </Button>
          {!usage?.addon && stripeAvailable && (
            <Button onClick={() => void startCheckout()} disabled={busy}>
              {busy ? "リダイレクト中…" : "アドオンを追加する"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ApiClientError の body から `usage` を取り出すユーティリティ。
 * 形が違うときは null を返す。
 */
export function extractQuotaInfo(body: unknown): QuotaInfo | null {
  if (!body || typeof body !== "object") return null;
  const u = (body as { usage?: unknown }).usage;
  if (!u || typeof u !== "object") return null;
  const x = u as Record<string, unknown>;
  if (
    typeof x.current === "number" &&
    typeof x.limit === "number" &&
    typeof x.addon === "boolean" &&
    typeof x.resetsAt === "string"
  ) {
    return {
      current: x.current,
      limit: x.limit,
      addon: x.addon,
      resetsAt: x.resetsAt,
    };
  }
  return null;
}
