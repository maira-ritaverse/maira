"use client";

/**
 * AI 月次上限の admin 編集 フォーム(Client Component)
 *
 * - 6 kind 分の カスタム上限を 入力
 * - 空欄 = 既定値、0 = 完全停止、正の整数 = 明示上限
 * - 「組織横断」「求職者 1 人あたり」を 2 セクションに 分けて 表示
 * - 保存は PUT /api/agency/ai-quotas(admin のみ。advisor は 上位ページで 既に block 済)
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { AI_KIND_LABEL } from "@/lib/agency/ai-kind-labels";

type Quota = {
  kind: string;
  monthlyLimit: number | null;
  defaultLimit: number;
  scope: "agency_org" | "seeker_per_user";
  updatedAt: string | null;
};

type Props = {
  initial: Quota[];
};

/** 数値 input の文字列を null | number に正規化 */
function parseLimit(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return NaN as unknown as number;
  return n;
}

export function AiQuotasForm({ initial }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial.map((q) => [q.kind, q.monthlyLimit === null ? "" : String(q.monthlyLimit)]),
    ),
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const orgKinds = initial.filter((q) => q.scope === "agency_org");
  const seekerKinds = initial.filter((q) => q.scope === "seeker_per_user");

  const save = () => {
    setError(null);
    setSuccess(null);

    // 入力をパースして payload を組む
    const quotas: Array<{ kind: string; monthlyLimit: number | null }> = [];
    for (const q of initial) {
      const v = values[q.kind] ?? "";
      const parsed = parseLimit(v);
      if (Number.isNaN(parsed)) {
        setError(`${AI_KIND_LABEL[q.kind] ?? q.kind}: 0 以上の整数で入力してください。`);
        return;
      }
      quotas.push({ kind: q.kind, monthlyLimit: parsed });
    }

    startTransition(async () => {
      try {
        await apiFetch<{ quotas: Quota[] }>("/api/agency/ai-quotas", {
          method: "PUT",
          json: { quotas },
        });
        setSuccess("上限を保存しました。");
        // SSR 側の表示も最新化(利用状況のサマリと整合性を保つ)
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const reset = () => {
    setValues(
      Object.fromEntries(
        initial.map((q) => [q.kind, q.monthlyLimit === null ? "" : String(q.monthlyLimit)]),
      ),
    );
    setError(null);
    setSuccess(null);
  };

  const renderRow = (q: Quota) => (
    <div key={q.kind} className="flex items-center gap-3 py-2">
      <div className="flex-1">
        <p className="text-sm font-medium">{AI_KIND_LABEL[q.kind] ?? q.kind}</p>
        <p className="text-muted-foreground text-[11px]">
          既定値:{q.defaultLimit.toLocaleString()} 回 / 月
          {q.updatedAt && (
            <span className="ml-2">({new Date(q.updatedAt).toLocaleDateString("ja-JP")} 更新)</span>
          )}
        </p>
      </div>
      <div className="w-32">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="既定"
          value={values[q.kind] ?? ""}
          onChange={(e) => setValues((prev) => ({ ...prev, [q.kind]: e.target.value }))}
          disabled={isPending}
        />
      </div>
      <span className="text-muted-foreground w-8 text-xs">回</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">組織側 AI(全メンバーの 合算月次上限)</h3>
        <div className="divide-foreground/10 divide-y">{orgKinds.map(renderRow)}</div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">連携 求職者 1 人あたり AI 上限</h3>
        <div className="divide-foreground/10 divide-y">{seekerKinds.map(renderRow)}</div>
      </div>

      <div className="text-muted-foreground space-y-1 text-[11px]">
        <p>・空欄:既定値が適用される</p>
        <p>・0:その機能を完全に停止</p>
        <p>・正の整数:明示的な月次上限</p>
        <p>・上限の対象は kind により異なる(組織横断 合算 / 求職者 1 人あたり)</p>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50/60 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded border border-emerald-200 bg-emerald-50/60 p-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {success}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={isPending}>
          {isPending ? "保存中…" : "保存する"}
        </Button>
        <Button onClick={reset} variant="outline" disabled={isPending}>
          初期値に戻す
        </Button>
      </div>
    </div>
  );
}
