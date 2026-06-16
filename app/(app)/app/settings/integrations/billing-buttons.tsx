"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

/**
 * Stripe Checkout / Billing Portal の遷移ボタン。
 *
 * - Checkout:アドオン購入。POST → 返ってきた URL に遷移。
 * - Portal:解約 / カード変更。POST → URL に遷移。
 *
 * 短命の URL を都度取りに行く方式。SSR で URL を埋めると古くなりがちなので避ける。
 */
export function StartCheckoutButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
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

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" onClick={() => void go()} disabled={busy || disabled}>
        {busy ? "リダイレクト中…" : "アドオンを追加する"}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

export function OpenPortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ url: string }>("/api/billing/portal-session", {
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

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={() => void go()} disabled={busy}>
        {busy ? "リダイレクト中…" : "アドオン管理(解約・カード変更)"}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
