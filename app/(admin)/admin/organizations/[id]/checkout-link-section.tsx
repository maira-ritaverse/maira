"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * 運営者が「指定組織の Stripe Checkout リンク」を発行するセクション。
 *
 * 発行したURLを顧客に送る(または開く)と、顧客が決済した時点で Stripe 側に
 * 顧客 + サブスクリプションが自動作成され、Webhook で organization_plans に自動同期される。
 * → 運営者が Stripe ダッシュボードで手動の顧客登録 / サブスク作成をする必要がなくなる。
 */
type Props = {
  organizationId: string;
};

// 販売中の tier(専用 Price を持つもの)。standard_rec / standard_premium は対象外。
const TIER_OPTIONS: { value: string; label: string; kind: "Team" | "Solo" }[] = [
  { value: "standard", label: "Standard(¥25,000〜/月・3席込み)", kind: "Team" },
  { value: "standard_pro", label: "Standard + Pro(+¥4,200/月・AI 1,000回)", kind: "Team" },
  { value: "solo", label: "Solo(¥10,000/月・1席)", kind: "Solo" },
  { value: "solo_pro", label: "Solo Pro(¥15,000/月・1席)", kind: "Solo" },
];

export function CheckoutLinkSection({ organizationId }: Props) {
  const [tier, setTier] = useState("solo");
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  // "0" = トライアルなし(即課金)、"" = プラン既定(Solo=14日 / Team=30日)、その他は日数。
  // 既定は「なし(即課金)」。運営が既存顧客に発行するリンクは即課金が自然で、うっかり
  // トライアルが付くのを防ぐ(トライアルを付けたい場合だけ明示的に選ぶ)。
  const [trial, setTrial] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = async () => {
    setLoading(true);
    setError(null);
    setUrl(null);
    setCopied(false);
    try {
      const trialDays = trial === "" ? undefined : Number(trial);
      const res = await fetch(`/api/admin/organizations/${organizationId}/checkout-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cycle, ...(trialDays !== undefined ? { trialDays } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as {
        url?: string;
        email?: string;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !body?.url) {
        setError(body?.message ?? body?.error ?? `発行に失敗しました(HTTP ${res.status})`);
        return;
      }
      setUrl(body.url);
      setEmail(body.email ?? null);
    } catch {
      setError("発行に失敗しました。通信状況をご確認ください。");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard 不可環境では手動選択してもらう
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">決済リンクの発行</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          この組織向けの Stripe Checkout リンクを発行します。顧客がこのリンクで決済すると、Stripe
          の顧客とサブスクリプションが自動作成され、アプリに自動反映されます(運営者が Stripe
          で手動登録する必要はありません)。
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">プラン</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              disabled={loading}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              {TIER_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}({t.kind})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">請求サイクル</label>
            <select
              value={cycle}
              onChange={(e) => setCycle(e.target.value as "monthly" | "yearly")}
              disabled={loading}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="monthly">月払い</option>
              <option value="yearly">年払い(2ヶ月分お得)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">無料トライアル</label>
            <select
              value={trial}
              onChange={(e) => setTrial(e.target.value)}
              disabled={loading}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="0">なし(即課金)</option>
              <option value="">プラン既定(Solo=14日 / Team=30日)</option>
              <option value="7">7日</option>
              <option value="14">14日</option>
              <option value="30">30日</option>
            </select>
          </div>
          <Button size="sm" onClick={issue} disabled={loading}>
            {loading ? "発行中…" : "リンクを発行"}
          </Button>
        </div>

        {url && (
          <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-medium text-emerald-900">
              発行しました。このURLを顧客({email ?? "組織の管理者"})に送ってください。
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="border-input bg-background w-full rounded-md border px-2 py-1.5 font-mono text-xs"
              />
              <Button size="sm" variant="outline" onClick={copy} className="shrink-0">
                {copied ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    コピー済み
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    コピー
                  </>
                )}
              </Button>
            </div>
            <p className="text-muted-foreground text-[11px]">
              リンクには有効期限があります。期限切れの場合は再発行してください。
            </p>
          </div>
        )}

        <p className="text-muted-foreground text-[11px]">
          既に有効なプラン(トライアル含む)の組織には発行できません(二重契約防止)。プラン変更は上の
          「プラン種別」や Billing Portal から行ってください。
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
