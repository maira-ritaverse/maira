"use client";

/**
 * 課金 免除 トグル セクション ( admin 詳細 ページ 用 )。
 *
 * - デフォルト は 課金 ON ( = is_billing_exempt: false )
 * - スイッチ で 免除 を 付与 / 解除
 * - 付与 時 は 理由 を 入力 ( 任意、 監査 用 )
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldOff } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  organizationId: string;
  initialIsExempt: boolean;
  initialReason: string | null;
  initialSetAt: string | null;
};

export function BillingExemptSection({
  organizationId,
  initialIsExempt,
  initialReason,
  initialSetAt,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isExempt, setIsExempt] = useState(initialIsExempt);
  const [reason, setReason] = useState(initialReason ?? "");
  const [setAt, setSetAt] = useState(initialSetAt);
  const [error, setError] = useState<string | null>(null);

  const submit = async (nextExempt: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/organizations/${organizationId}/billing-exempt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exempt: nextExempt,
            reason: nextExempt ? reason.trim() || null : null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "保存に失敗しました");
          return;
        }
        setIsExempt(nextExempt);
        setSetAt(new Date().toISOString());
        if (!nextExempt) setReason("");
        router.refresh();
      } catch {
        setError("保存に失敗しました");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">課金免除</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          ON にすると Stripe 課金 を スキップ し、 「課金中相当」 として 扱います。 運営テスト
          アカウント や 試用提携先 用。 デフォルトは OFF (課金 が ベース)。
        </p>
      </div>

      <div
        className={`rounded-lg border p-4 ${
          isExempt ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {isExempt ? (
              <ShieldOff className="mt-0.5 size-5 text-amber-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-5 text-slate-500" />
            )}
            <div>
              <p
                className={`text-sm font-semibold ${
                  isExempt ? "text-amber-800" : "text-slate-700"
                }`}
              >
                {isExempt ? "課金 免除 中" : "課金 ON ( 通常 )"}
              </p>
              {isExempt && setAt && (
                <p className="text-muted-foreground mt-1 text-xs">
                  設定日時: {new Date(setAt).toLocaleString("ja-JP")}
                </p>
              )}
              {isExempt && initialReason && (
                <p className="mt-1 text-xs text-slate-700">理由: {initialReason}</p>
              )}
            </div>
          </div>
          {isExempt ? (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => submit(false)}>
              免除を解除して課金 ON
            </Button>
          ) : (
            <Button size="sm" disabled={isPending} onClick={() => submit(true)}>
              課金を免除する
            </Button>
          )}
        </div>
      </div>

      {!isExempt && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">免除する理由 (任意、 監査用)</label>
          <Input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 運営テストアカウント / 試用提携先 等"
            maxLength={500}
          />
          <p className="text-muted-foreground text-xs">
            「課金を免除する」 を 押した 時点 で この 理由 が 記録されます。
          </p>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
