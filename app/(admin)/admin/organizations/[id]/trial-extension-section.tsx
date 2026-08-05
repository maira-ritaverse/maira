"use client";

/**
 * トライアル延長セクション(admin 詳細ページ用)。
 *
 * - 現在のトライアル終了日 + 残り日数(色分け)を表示
 * - クイックボタン(+7 / +14 / +30 日)+ 日数自由入力で延長
 * - 有料契約中 / 未契約の組織は延長操作を出さず、理由を表示する
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TrialState } from "@/lib/billing/trial";

const DAY_MS = 24 * 60 * 60 * 1000;
const QUICK_DAYS = [7, 14, 30] as const;

type Props = {
  organizationId: string;
  initial: TrialState;
};

export function TrialExtensionSection({ organizationId, initial }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [trialEndsAt, setTrialEndsAt] = useState(initial.trialEndsAt);
  const [days, setDays] = useState("14");
  const [error, setError] = useState<string | null>(null);
  // レンダー中の Date.now() は react-hooks/purity 違反になるため state に固定する。
  const [nowMs] = useState(() => Date.now());

  const submit = (n: number) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/organizations/${organizationId}/extend-trial`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: n }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            message?: string;
            error?: string;
          } | null;
          setError(body?.message ?? body?.error ?? "延長に失敗しました");
          return;
        }
        const body = (await res.json()) as { newTrialEndsAt?: string };
        if (body.newTrialEndsAt) setTrialEndsAt(body.newTrialEndsAt);
        router.refresh();
      } catch {
        setError("延長に失敗しました");
      }
    });
  };

  const onCustom = () => {
    const n = Number(days.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      setError("延長日数は 1〜365 の整数で入力してください。");
      return;
    }
    submit(n);
  };

  const endMs = trialEndsAt ? new Date(trialEndsAt).getTime() : null;
  const expired = endMs != null && Number.isFinite(endMs) && endMs <= nowMs;
  const remainDays =
    endMs != null && Number.isFinite(endMs) && endMs > nowMs
      ? Math.ceil((endMs - nowMs) / DAY_MS)
      : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">トライアル期間の延長</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          無料トライアルの終了日を延ばします。まだ有料契約に進んでいない企業に、追加の試用期間を付与できます。
        </p>
      </div>

      {!initial.hasPlan ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          この組織にはプラン情報がありません(未契約)。トライアル延長の対象外です。
        </div>
      ) : initial.hasStripeSubscription ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          この組織は Stripe 契約があるため、トライアル延長の対象外です(契約状態は Stripe
          側で管理されます)。
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <CalendarClock className="size-5 text-slate-500" />
              <span className="text-muted-foreground">現在のトライアル終了日:</span>
              <span className="font-semibold">
                {trialEndsAt ? new Date(trialEndsAt).toLocaleDateString("ja-JP") : "未設定"}
              </span>
              {(expired || remainDays != null) && (
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                    expired
                      ? "bg-red-100 text-red-800"
                      : remainDays != null && remainDays <= 7
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {expired ? "期限切れ" : `残り${remainDays}日`}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">延長する日数</label>
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_DAYS.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => submit(d)}
                >
                  +{d}日
                </Button>
              ))}
              <span className="text-muted-foreground text-xs">または</span>
              <Input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                disabled={isPending}
                className="w-24"
              />
              <span className="text-sm">日</span>
              <Button size="sm" disabled={isPending} onClick={onCustom}>
                {isPending ? "延長中…" : "延長する"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              終了日が未来ならその日から、過ぎていれば本日から、指定日数だけ延長します。延長すると状態は「トライアル中」に戻ります。
            </p>
          </div>
        </>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
