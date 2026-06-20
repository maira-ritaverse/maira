"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  computePrice,
  PLAN_TIER_LABEL,
  PRICING,
  TIER_UPGRADE_MONTHLY,
  type PlanTier,
} from "@/lib/billing/agency";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * トライアル中 の admin が 「トライアル 終了後 継続したい アップグレード」を
 * 選択 する フォーム。
 *
 * 4 択 (排他):Standard のみ / 録音 / Pro / Premium
 * 未選択 (null) は Standard のみ と 同義。
 *
 * 値の 確定 は /api/agency/billing/trial-upgrade-choice (POST) 経由。
 */
type Props = {
  initialChoice: PlanTier | null;
  trialEndsAt: string;
  memberCount: number;
};

const OPTIONS: { value: PlanTier; description: string }[] = [
  {
    value: "standard",
    description: "Standard のみ (録音 / Pro 機能 なし、AI 500 回 / 月)",
  },
  {
    value: "standard_rec",
    description: "+ 録音 (月 50 件、1 件 90 分まで、AI 500 回 / 月)",
  },
  {
    value: "standard_pro",
    description: "+ Pro (AI 月 1,000 回、録音 なし)",
  },
  {
    value: "standard_premium",
    description: "+ Premium (AI 月 1,000 回 + 録音 月 50 件、別々購入比 15% OFF)",
  },
];

export function TrialUpgradeChoiceForm({ initialChoice, trialEndsAt, memberCount }: Props) {
  // 初期値:DB の trial_upgrade_choice、 null なら 'standard' (= 解除)
  const [selected, setSelected] = useState<PlanTier>(initialChoice ?? "standard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/billing/trial-upgrade-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: selected }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSavedAt(new Date());
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const trialEndDate = trialEndsAt ? new Date(trialEndsAt).toLocaleDateString("ja-JP") : "(未設定)";

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">トライアル 終了後 の プラン</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        無料期間 (〜 {trialEndDate}) の 終了後 に 継続したい プラン を 選択 して ください。 何も
        選択 しない 場合、 Standard のみ に なります (録音 / Pro 機能 は 解除)。
      </p>

      <div className="mt-4 space-y-2">
        {OPTIONS.map((opt) => {
          const price = computePrice(opt.value, memberCount, "monthly");
          const upgradeAmount = TIER_UPGRADE_MONTHLY[opt.value];
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                selected === opt.value
                  ? "border-emerald-500 bg-emerald-50"
                  : "hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="upgrade-choice"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{PLAN_TIER_LABEL[opt.value]}</span>
                  <span className="text-sm font-bold">
                    ¥{price.monthlyTotal.toLocaleString()} / 月
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">{opt.description}</p>
                {upgradeAmount > 0 && (
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    (Standard ¥{PRICING.baseMonthly.toLocaleString()} + 4 人目以降 ¥
                    {Math.max(0, memberCount - PRICING.includedSeats) * PRICING.perSeatMonthly} +
                    アップグレード ¥{upgradeAmount.toLocaleString()})
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {savedAt && !error && (
        <p className="text-muted-foreground mt-4 text-xs">
          選択を 保存しました ({savedAt.toLocaleTimeString("ja-JP")})。 トライアル 終了時 に 反映
          されます。
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={submit} disabled={saving}>
          {saving ? "保存中..." : "選択を 保存"}
        </Button>
      </div>
    </Card>
  );
}
