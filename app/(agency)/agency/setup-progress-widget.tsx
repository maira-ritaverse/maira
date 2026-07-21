import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";

import { Card } from "@/components/ui/card";

/**
 * 新規 admin 向け セットアップ進捗 チェックリスト。
 *
 * 背景: 新規 admin が signup 直後 に ダッシュボード に 到達 して も 「まず 何 を すれば
 * よい か」 が 全く わから ない (P0 UX bug)。 対策 と して、 5 つ の 主要 セットアップ
 * ステップ を チェックリスト 化 し、 未完了 の 間 だけ 表示 する。
 *
 * ・完了 = チェック マーク + 打ち消し 線 (ページ 遷移 なし)
 * ・未完了 = 遷移 リンク + 説明
 * ・すべて 完了 したら null を 返す ので、 呼び出し 側 は 「表示 なし」 に なる
 * ・admin 以外 に は 呼び出し 側 で 出し 分け る (props を そもそも 渡さ ない 想定)
 */

export type SetupStep = {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

type Props = {
  steps: SetupStep[];
};

export function SetupProgressWidget({ steps }: Props) {
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  // 全部 完了 したら 表示 しない (「もう 済んだ もの を 見せ 続ける」 のは ノイズ)
  if (doneCount === total) return null;

  return (
    <Card className="border-primary/30 bg-primary/5 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold">セットアップの進捗</p>
          <p className="text-muted-foreground text-xs">
            以下のステップを完了すると Myaira を最大限に活用できます。
          </p>
        </div>
        <div className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {doneCount} / {total} 完了
        </div>
      </div>

      <ul className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.id}>
            {step.done ? (
              <div className="text-muted-foreground flex items-center gap-2 rounded px-2 py-1.5 text-sm">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
                <span className="flex-1 truncate line-through">{step.label}</span>
              </div>
            ) : (
              <Link
                href={step.href}
                className="hover:bg-accent group flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors"
              >
                <Circle className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{step.label}</p>
                  <p className="text-muted-foreground text-[11px]">{step.description}</p>
                </div>
                <ArrowRight
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
