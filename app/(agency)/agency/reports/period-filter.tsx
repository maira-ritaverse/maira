"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Period, PeriodPreset } from "@/lib/reports/queries";

/**
 * レポート共通の期間フィルタ
 *
 * 状態は URL の searchParams に持たせる:
 *   ?period=this-month
 *   ?period=last-month
 *   ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Server Component(page.tsx)がそれを読んで集計するので、ここから
 * router.push するだけで再描画される。
 *
 * D(ステータス分布)はスナップショットで期間に依存しないが、
 * 後続の A/C/E がこの値を使う前提で土台として用意する。
 */
export function PeriodFilter({ period }: { period: Period }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // custom 用の入力値はローカルで保持(URL 更新は「適用」押下時のみ)
  const [customFrom, setCustomFrom] = useState(period.from);
  const [customTo, setCustomTo] = useState(period.to);

  const updateUrl = useCallback(
    (next: { preset: PeriodPreset; from?: string; to?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", next.preset);
      if (next.preset === "custom") {
        if (next.from) params.set("from", next.from);
        if (next.to) params.set("to", next.to);
      } else {
        params.delete("from");
        params.delete("to");
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const presets: { value: PeriodPreset; label: string }[] = [
    { value: "this-month", label: "今月" },
    { value: "last-month", label: "先月" },
    { value: "custom", label: "任意期間" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-md border p-1">
        {presets.map((p) => {
          const active = period.preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => updateUrl({ preset: p.value, from: customFrom, to: customTo })}
              className={`rounded px-3 py-1 text-sm transition-colors ${
                active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {period.preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="w-40"
          />
          <span className="text-muted-foreground text-sm">〜</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="w-40"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => updateUrl({ preset: "custom", from: customFrom, to: customTo })}
            disabled={!customFrom || !customTo || customFrom > customTo}
          >
            適用
          </Button>
        </div>
      )}

      <span className="text-muted-foreground text-xs">
        {period.from} 〜 {period.to}
      </span>
    </div>
  );
}
