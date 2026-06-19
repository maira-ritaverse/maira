"use client";

/**
 * Maira admin による 「企業ごとの AI 強制上限」編集 UI
 *
 * 用途:
 *   ・料金プラン強制(プラン別 既定値 を 運営側で 固定)
 *   ・暴走時 緊急介入(monthlyLimit = 0 で 即停止)
 *
 * 仕様:
 *   ・8 kind 分の 上限を kind 別 に 入力
 *   ・空欄 = 解除(エージェント側 設定 / 既定値 に 戻る)
 *   ・0 = 完全停止、1 以上 = 強制上限
 *   ・notes は 任意(「Pro プラン」「無料」等の メモ)
 *   ・保存は PUT /api/admin/organizations/[id]/ai-quotas
 *
 * セキュリティ:
 *   isMairaAdmin ガードは layout / API 二重で 既に 効いて いる。
 */
import { useEffect, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_KIND_LABEL } from "@/lib/agency/ai-kind-labels";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

const KIND_ORDER = [
  "photo_enhance",
  "job_recommendation_seeker",
  "job_recommendation_agency",
  "recommendation_letter_draft",
  "agency_cv_draft",
  "agency_resume_draft",
  "job_extract_from_document",
  "csv_column_mapping",
] as const;

type RowState = {
  /** 数値文字列 or "" (= 解除) */
  limit: string;
  notes: string;
  updatedAt: string | null;
};

type ApiResponse = {
  quotas: Array<{
    kind: string;
    monthlyLimit: number;
    notes: string | null;
    updatedAt: string;
  }>;
};

type Props = {
  organizationId: string;
};

function emptyRow(): RowState {
  return { limit: "", notes: "", updatedAt: null };
}

function parseLimit(input: string): number | null | "invalid" {
  const trimmed = input.trim();
  if (trimmed === "") return null; // 解除
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > 100_000) return "invalid";
  return n;
}

export function PlatformAiQuotasSection({ organizationId }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(KIND_ORDER.map((k) => [k, emptyRow()])),
  );
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/organizations/${organizationId}/ai-quotas`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ApiResponse;
        if (!active) return;
        const next: Record<string, RowState> = Object.fromEntries(
          KIND_ORDER.map((k) => [k, emptyRow()]),
        );
        for (const q of data.quotas) {
          next[q.kind] = {
            limit: String(q.monthlyLimit),
            notes: q.notes ?? "",
            updatedAt: q.updatedAt,
          };
        }
        setRows(next);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [organizationId]);

  const update = (kind: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  };

  const save = () => {
    setError(null);
    setSuccess(null);

    const quotas: Array<{ kind: string; monthlyLimit: number | null; notes?: string }> = [];
    for (const kind of KIND_ORDER) {
      const r = rows[kind];
      const parsed = parseLimit(r.limit);
      if (parsed === "invalid") {
        setError(`${AI_KIND_LABEL[kind] ?? kind}: 0 以上 100000 以下の 整数 で 入力してください。`);
        return;
      }
      quotas.push({
        kind,
        monthlyLimit: parsed,
        notes: r.notes.trim() ? r.notes.trim() : undefined,
      });
    }

    startTransition(async () => {
      try {
        const res = await apiFetch<ApiResponse>(
          `/api/admin/organizations/${organizationId}/ai-quotas`,
          { method: "PUT", json: { quotas } },
        );
        const next: Record<string, RowState> = Object.fromEntries(
          KIND_ORDER.map((k) => [k, emptyRow()]),
        );
        if (res) {
          for (const q of res.quotas) {
            next[q.kind] = {
              limit: String(q.monthlyLimit),
              notes: q.notes ?? "",
              updatedAt: q.updatedAt,
            };
          }
        }
        setRows(next);
        setSuccess("強制上限を 保存しました。");
      } catch (e) {
        setError(getErrorMessage(e));
      }
    });
  };

  if (loading) {
    return <p className="text-muted-foreground text-sm">読み込み中...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">AI 強制上限(運営者設定)</h2>
        <p className="text-muted-foreground text-xs">
          各 AI 機能 の 月次上限 を 運営側 で 上書き 強制します。空欄 = 解除(エージェント設定 /
          既定値 に 戻る)。0 = 完全停止、1 以上 = 強制上限。
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
        <table className="min-w-full bg-white text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">機能</th>
              <th className="px-3 py-2 text-left font-medium" style={{ width: "8em" }}>
                月次上限
              </th>
              <th className="px-3 py-2 text-left font-medium">プラン / メモ</th>
              <th className="px-3 py-2 text-left font-medium" style={{ width: "12em" }}>
                最終更新
              </th>
            </tr>
          </thead>
          <tbody>
            {KIND_ORDER.map((kind) => {
              const r = rows[kind];
              return (
                <tr key={kind} className="border-t border-slate-100">
                  <td className="px-3 py-2 align-top">{AI_KIND_LABEL[kind] ?? kind}</td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      type="number"
                      min={0}
                      max={100000}
                      placeholder="(解除)"
                      value={r.limit}
                      onChange={(e) => update(kind, { limit: e.target.value })}
                      disabled={isPending}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      type="text"
                      placeholder="例: Pro プラン"
                      value={r.notes}
                      onChange={(e) => update(kind, { notes: e.target.value })}
                      disabled={isPending}
                      maxLength={200}
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-[10px] text-slate-500">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleString("ja-JP") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={isPending}>
          {isPending ? "保存中..." : "強制上限を 保存"}
        </Button>
      </div>
    </div>
  );
}
