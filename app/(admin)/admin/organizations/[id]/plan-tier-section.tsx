"use client";

/**
 * プラン種別(Team 系 ⇄ Solo 系)切替セクション(運営者の組織詳細ページ用)。
 *
 * - organization_plans.tier を直接更新する運営者オーバーライド(Stripe 課金とは非同期)。
 * - Solo(個人事業主)= 1 席想定 / Team(法人)= 複数席。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PLAN_TIERS, PLAN_TIER_LABEL, SOLO_TIERS } from "@/lib/billing/agency";

type Props = {
  organizationId: string;
  initialTier: string;
  memberCount: number;
};

const LABEL = PLAN_TIER_LABEL as Record<string, string>;
const SOLO = SOLO_TIERS as readonly string[];
// PLAN_TIERS は Team 系のみ。Solo 系(SOLO_TIERS)を合わせて全 tier を候補にする。
const ALL_TIERS: readonly string[] = [...PLAN_TIERS, ...SOLO_TIERS];

export function PlanTierSection({ organizationId, initialTier, memberCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tier, setTier] = useState(initialTier);
  const [savedTier, setSavedTier] = useState(initialTier);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const soloWithMultiMembers = SOLO.includes(tier) && memberCount > 1;

  const submit = () => {
    const label = LABEL[tier] ?? tier;
    if (
      !window.confirm(
        `プラン種別を「${label}」に変更します。Stripe 課金とは同期しないため、課金は別途調整が必要です。よろしいですか?`,
      )
    ) {
      return;
    }
    setError(null);
    setDone(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/organizations/${organizationId}/tier`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "保存に失敗しました");
          return;
        }
        setSavedTier(tier);
        setDone(true);
        router.refresh();
      } catch {
        setError("保存に失敗しました");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">プラン種別(Team ⇄ Solo)</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          法人(Team 系)と個人事業主(Solo 系)を切り替えます。organization_plans.tier
          を直接更新する運営者オーバーライドで、Stripe 課金とは同期しません(課金は別途調整)。
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm">
          現在: <strong>{LABEL[savedTier] ?? savedTier}</strong>(
          {SOLO.includes(savedTier) ? "Solo" : "Team"}
          ・メンバー {memberCount} 名)
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">変更後のプラン</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              disabled={isPending}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              {ALL_TIERS.map((t) => (
                <option key={t} value={t}>
                  {LABEL[t] ?? t}({SOLO.includes(t) ? "Solo" : "Team"})
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" disabled={isPending || tier === savedTier} onClick={submit}>
            {isPending ? "保存中…" : "変更する"}
          </Button>
        </div>
        {soloWithMultiMembers && (
          <p className="text-xs text-amber-700">
            注意:Solo 系は 1 席想定です。この組織はメンバーが {memberCount} 名います。Solo
            に変更しても既存メンバーは残りますが、招待などの Team 機能は制限されます。
          </p>
        )}
        {done && <p className="text-xs text-emerald-700">変更しました。</p>}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
