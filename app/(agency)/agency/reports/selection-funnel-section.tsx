"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SelectionFunnel } from "@/lib/reports/queries";

type Props = {
  application: SelectionFunnel;
  candidate: SelectionFunnel;
};

type Mode = "application" | "candidate";

/**
 * B:選考ファネル(通過率)
 *
 * 2 つの視点を切り替えて見る:
 *   - 応募ベース(application):referral 単位の通過率
 *       「送った推薦のうち、どこまで進んだか」
 *   - 求職者ベース(candidate):client_record 単位の通過率(最高到達段階)
 *       「何人の求職者を、各段階まで導けたか」
 *
 * 数え方の違いは brief 指定。1 人が複数応募していると 2 つの数字は乖離するが、
 * それぞれが別の問いに答えるので両方残す。
 *
 * 表示は同一の横棒レイアウトを再利用し、データだけ差し替える。
 *
 * Client Component(切替の useState のため)。
 * バー本体は同じ DOM、ラベル/数字のみが mode で切り替わる。
 */
export function SelectionFunnelSection({ application, candidate }: Props) {
  const [mode, setMode] = useState<Mode>("application");
  const data = mode === "application" ? application : candidate;
  const { stages, base, declinedCount, period } = data;
  const isEmpty = base === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>選考ファネル(通過率)</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          {period.from} 〜 {period.to} に作成された紹介(referrals.created_at)を母数に集計。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 視点切替 — ユーザーが「何を見ているか」を誤解しないよう明示ラベル */}
        <div className="space-y-2">
          <div className="flex items-center gap-1 rounded-md border p-1 text-sm">
            <ModeTab
              active={mode === "application"}
              onClick={() => setMode("application")}
              label="応募ベース"
            />
            <ModeTab
              active={mode === "candidate"}
              onClick={() => setMode("candidate")}
              label="求職者ベース"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {mode === "application" ? (
              <>
                応募(referral)単位 —
                送った推薦の通過率。同じ求職者の複数応募はそれぞれ別件として数えます。
              </>
            ) : (
              <>
                求職者(client_record)単位 — 何人を各段階まで導けたか。
                同じ求職者の複数応募は「最高到達段階」で 1 人としてカウントします。
              </>
            )}
          </p>
        </div>

        {isEmpty ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            {mode === "application"
              ? "この期間に作成された紹介がありません。"
              : "この期間に紹介を持つ求職者がいません。"}
          </p>
        ) : (
          <ol className="space-y-2">
            {stages.map((s) => (
              <li key={s.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {s.count} {mode === "application" ? "件" : "人"} ({s.passRate}%)
                  </span>
                </div>
                <div className="bg-muted h-6 w-full overflow-hidden rounded-md">
                  <div
                    className="h-full rounded-md transition-all"
                    style={{
                      width: `${Math.max(s.passRate, base > 0 && s.count > 0 ? 2 : 0)}%`,
                      backgroundColor: s.color,
                    }}
                    aria-label={`${s.label} ${s.count} ${mode === "application" ? "件" : "人"} ${s.passRate}%`}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* declined の取り扱いは両ビューで共通だが、母数の単位だけ違う */}
        <div className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
          <p>
            母数:紹介到達 {base} {mode === "application" ? "件" : "人"}(declined 含む)
          </p>
          <p>
            {mode === "application" ? (
              <>
                内、不採用(declined):{declinedCount} 件
                <span className="ml-1 opacity-80">
                  ※ 母数のみカウント。脱落段階の特定は現状の status からは追えない(履歴未参照)
                </span>
              </>
            ) : (
              <>
                内、全応募 declined:{declinedCount} 人
                <span className="ml-1 opacity-80">
                  ※ 保有 referral がすべて declined の求職者。1 つでも生きていれば最高段階に算入
                </span>
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-3 py-1 text-sm transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
