"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/api/client-fetch";
import {
  computeStripePrice,
  STRIPE_INCLUDED_SEATS,
  type StripeCycle,
  type StripeTier,
} from "@/lib/billing/stripe-pricing";

/**
 * 未 契約 の 組織 向け の 「プラン 選択 → Checkout」 フォーム (Client Component)。
 *
 * ・tier: Standard / Standard + Pro
 * ・cycle: 月払い / 年払い (2 ヶ月 分 割引)
 * ・選択 中 の 内訳 と 合計 を リアル タイム 表示 (純関数 computeStripePrice)
 * ・「Checkout に 進む」 で POST /api/agency/billing/checkout-session
 *   ・成功 → 返って きた URL に window.location で 遷移
 *   ・409 (already_subscribed 等) → 状態 別 の 案内 を 表示
 *
 * 席 数 は サーバー 側 で メンバー 数 から 自動 集計 する ので フォーム で は 触ら ない。
 */
type Props = {
  currentSeatCount: number;
};

export function PlanSelectForm({ currentSeatCount }: Props) {
  const [tier, setTier] = useState<StripeTier>("standard");
  const [cycle, setCycle] = useState<StripeCycle>("monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = computeStripePrice({ tier, seatCount: currentSeatCount, cycle });
  const extraSeats = Math.max(0, currentSeatCount - STRIPE_INCLUDED_SEATS);

  const startCheckout = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cycle }),
      });
      const body = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.url;
    } catch (e) {
      setError(getErrorMessage(e));
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">プラン に 加入 する</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        30 日 の 無料 期間 付き。 期間 中 の 解約 は 一切 課金 されません。
      </p>

      <div className="mt-4 space-y-3">
        <TierOption
          value="standard"
          selected={tier === "standard"}
          onSelect={() => setTier("standard")}
          title="Standard"
          description="AI 月 500 回、 会議 録音 手動 アップロード"
        />
        <TierOption
          value="standard_pro"
          selected={tier === "standard_pro"}
          onSelect={() => setTier("standard_pro")}
          title="Standard + Pro"
          description="AI 月 1,000 回 (+ 500 回)、 会議 録音 手動 アップロード"
        />
      </div>

      <div className="mt-6">
        <div className="text-muted-foreground mb-2 text-xs">課金 サイクル</div>
        <div className="grid grid-cols-2 gap-2">
          <CycleOption
            selected={cycle === "monthly"}
            onSelect={() => setCycle("monthly")}
            title="月払い"
            sub="毎月 請求"
          />
          <CycleOption
            selected={cycle === "yearly"}
            onSelect={() => setCycle("yearly")}
            title="年払い"
            sub="2 ヶ月 分 割引"
          />
        </div>
      </div>

      <hr className="my-6" />

      <div className="space-y-2 text-sm">
        <PriceRow label={`Base (${STRIPE_INCLUDED_SEATS} 席 込み)`}>
          ¥{price.base.toLocaleString()}
        </PriceRow>
        {extraSeats > 0 && (
          <PriceRow label={`Extra Seat (${extraSeats} 席)`}>
            ¥{price.extraSeat.toLocaleString()}
          </PriceRow>
        )}
        {tier === "standard_pro" && (
          <PriceRow label="AI Boost">¥{price.aiBoost.toLocaleString()}</PriceRow>
        )}

        {cycle === "monthly" ? (
          <div className="flex items-center justify-between border-t pt-2">
            <span className="font-semibold">月額 合計 (税別)</span>
            <span className="text-base font-bold text-emerald-700">
              ¥{price.monthlyTotal.toLocaleString()}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="font-semibold">年額 合計 (税別)</span>
              <span className="text-base font-bold text-emerald-700">
                ¥{price.yearlyTotal.toLocaleString()}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              月 単価 相当 ¥{price.yearlyMonthlyEquivalent.toLocaleString()} (月払い 比 で 2 ヶ月 分
              お得)
            </p>
          </>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6 flex justify-end">
        <Button onClick={startCheckout} disabled={loading}>
          {loading ? "遷移 中…" : "Stripe Checkout に 進む"}
        </Button>
      </div>
    </Card>
  );
}

function TierOption({
  value,
  selected,
  onSelect,
  title,
  description,
}: {
  value: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
        selected ? "border-emerald-500 bg-emerald-50" : "hover:border-slate-300"
      }`}
    >
      <input
        type="radio"
        name="tier"
        value={value}
        checked={selected}
        onChange={onSelect}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">{description}</div>
      </div>
    </label>
  );
}

function CycleOption({
  selected,
  onSelect,
  title,
  sub,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-md border p-3 text-left transition-colors ${
        selected ? "border-emerald-500 bg-emerald-50" : "hover:border-slate-300"
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>
    </button>
  );
}

function PriceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{children}</span>
    </div>
  );
}
