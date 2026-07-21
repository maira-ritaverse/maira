"use client";

/**
 * Myaira admin による 「企業 ごとの AI 強制上限」編集 UI
 *
 * 用途:
 *   ・料金プラン強制(プラン別 既定値 を 運営側で 固定)
 *   ・暴走時 緊急介入(monthlyLimit = 0 で 即停止)
 *
 * セクション分割:
 *   ① 月次 総量上限 (agency_org 合算 / 既定 500 / 求職者は 含めない)
 *   ② エージェント職員 向け (agency_org scope の 6 kind)
 *   ③ 求職者 向け (seeker_per_user scope の 2 kind)
 *     ※ 将来 アプリ内 課金 で 上限解除 する 設計余地あり
 *
 * 仕様:
 *   ・空欄 = 解除 (エージェント設定 or 既定値 に 戻る)
 *   ・0 = 完全停止、1 以上 = 強制上限
 *   ・notes は 任意 (「Pro プラン」「無料」等の メモ)
 *   ・保存は PUT /api/admin/organizations/[id]/ai-quotas
 */
import { useEffect, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_KIND_LABEL, AI_KIND_SCOPE_LABEL } from "@/lib/agency/ai-kind-labels";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

const AGENCY_KINDS = [
  "job_recommendation_agency",
  "recommendation_letter_draft",
  "agency_cv_draft",
  "agency_resume_draft",
  "job_extract_from_document",
  "csv_column_mapping",
] as const;

const SEEKER_KINDS = ["photo_enhance", "job_recommendation_seeker"] as const;

const ALL_KINDS = [...AGENCY_KINDS, ...SEEKER_KINDS] as const;

const DEFAULT_TOTAL_LIMIT = 500;

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
  total: {
    monthlyLimit: number;
    notes: string | null;
    updatedAt: string;
  } | null;
};

type Props = {
  organizationId: string;
};

function emptyRow(): RowState {
  return { limit: "", notes: "", updatedAt: null };
}

function parseLimit(input: string): number | null | "invalid" {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > 1_000_000) return "invalid";
  return n;
}

export function PlatformAiQuotasSection({ organizationId }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(ALL_KINDS.map((k) => [k, emptyRow()])),
  );
  const [total, setTotal] = useState<RowState>(emptyRow());
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
          ALL_KINDS.map((k) => [k, emptyRow()]),
        );
        for (const q of data.quotas) {
          next[q.kind] = {
            limit: String(q.monthlyLimit),
            notes: q.notes ?? "",
            updatedAt: q.updatedAt,
          };
        }
        setRows(next);
        if (data.total) {
          setTotal({
            limit: String(data.total.monthlyLimit),
            notes: data.total.notes ?? "",
            updatedAt: data.total.updatedAt,
          });
        } else {
          setTotal(emptyRow());
        }
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

  const updateRow = (kind: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  };

  const save = () => {
    setError(null);
    setSuccess(null);

    const quotas: Array<{ kind: string; monthlyLimit: number | null; notes?: string }> = [];
    for (const kind of ALL_KINDS) {
      const r = rows[kind];
      const parsed = parseLimit(r.limit);
      if (parsed === "invalid") {
        setError(`${AI_KIND_LABEL[kind] ?? kind}: 0 以上の 整数 で 入力してください。`);
        return;
      }
      quotas.push({
        kind,
        monthlyLimit: parsed,
        notes: r.notes.trim() ? r.notes.trim() : undefined,
      });
    }

    const totalParsed = parseLimit(total.limit);
    if (totalParsed === "invalid") {
      setError("総量上限: 0 以上の 整数 で 入力してください。");
      return;
    }

    startTransition(async () => {
      try {
        const res = await apiFetch<ApiResponse>(
          `/api/admin/organizations/${organizationId}/ai-quotas`,
          {
            method: "PUT",
            json: {
              quotas,
              total: {
                monthlyLimit: totalParsed,
                notes: total.notes.trim() ? total.notes.trim() : undefined,
              },
            },
          },
        );
        // 反映
        const next: Record<string, RowState> = Object.fromEntries(
          ALL_KINDS.map((k) => [k, emptyRow()]),
        );
        if (res) {
          for (const q of res.quotas) {
            next[q.kind] = {
              limit: String(q.monthlyLimit),
              notes: q.notes ?? "",
              updatedAt: q.updatedAt,
            };
          }
          setRows(next);
          if (res.total) {
            setTotal({
              limit: String(res.total.monthlyLimit),
              notes: res.total.notes ?? "",
              updatedAt: res.total.updatedAt,
            });
          } else {
            setTotal(emptyRow());
          }
        }
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
    <div className="space-y-6">
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

      {/* ① 月次 総量上限 */}
      <section className="space-y-2 rounded-md border border-amber-200 bg-amber-50/40 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-amber-900">月次 総量上限</h3>
          <p className="text-[10px] text-amber-900/70">
            既定 {DEFAULT_TOTAL_LIMIT} / agency_org 合算 / 求職者 は 含めない
          </p>
        </div>
        <p className="text-xs text-amber-900/80">
          エージェント職員の 月次 AI 利用 合計 が この 値 を 超えると、 該当企業の 全 AI が
          停止します。 空欄 = 既定 {DEFAULT_TOTAL_LIMIT}。 0 = 完全停止。
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div>
            <label className="text-[11px] text-amber-900/80">月次総量</label>
            <Input
              type="number"
              min={0}
              max={1_000_000}
              placeholder={`既定 ${DEFAULT_TOTAL_LIMIT}`}
              value={total.limit}
              onChange={(e) => setTotal((t) => ({ ...t, limit: e.target.value }))}
              disabled={isPending}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] text-amber-900/80">プラン / メモ</label>
            <Input
              type="text"
              placeholder="例: Pro プラン"
              value={total.notes}
              onChange={(e) => setTotal((t) => ({ ...t, notes: e.target.value }))}
              disabled={isPending}
              maxLength={200}
            />
          </div>
        </div>
        {total.updatedAt && (
          <p className="text-[10px] text-amber-900/60">
            最終更新: {new Date(total.updatedAt).toLocaleString("ja-JP")}
          </p>
        )}
      </section>

      {/* ② エージェント職員 向け */}
      <QuotaTable
        title="② エージェント職員 向け(個別 kind 上限)"
        description="agency_org 系。総量上限 と 並行 で 効きます (より 厳しい 方が 適用)。"
        kinds={AGENCY_KINDS}
        rows={rows}
        onChange={updateRow}
        disabled={isPending}
      />

      {/* ③ 求職者 向け */}
      <QuotaTable
        title="③ 求職者 向け(個別 kind 上限)"
        description="seeker_per_user 系。 求職者 1 人 あたり の 月次上限。 総量上限 (②) には 含めません。 将来 アプリ内 課金 で 自動解除 予定。"
        kinds={SEEKER_KINDS}
        rows={rows}
        onChange={updateRow}
        disabled={isPending}
      />

      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={isPending}>
          {isPending ? "保存中..." : "強制上限 を 保存"}
        </Button>
      </div>
    </div>
  );
}

function QuotaTable({
  title,
  description,
  kinds,
  rows,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  kinds: ReadonlyArray<string>;
  rows: Record<string, RowState>;
  onChange: (kind: string, patch: Partial<RowState>) => void;
  disabled: boolean;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
        <table className="min-w-full bg-white text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">機能</th>
              <th className="px-3 py-2 text-left font-medium" style={{ width: "10em" }}>
                月次上限
              </th>
              <th className="px-3 py-2 text-left font-medium">プラン / メモ</th>
              <th className="px-3 py-2 text-left font-medium" style={{ width: "12em" }}>
                最終更新
              </th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((kind) => {
              const r = rows[kind];
              const scope = AI_KIND_SCOPE_LABEL[kind];
              return (
                <tr key={kind} className="border-t border-slate-100">
                  <td className="px-3 py-2 align-top">
                    <div>{AI_KIND_LABEL[kind] ?? kind}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {scope === "agency_org" ? "組織横断" : "求職者 1 人 あたり"}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      type="number"
                      min={0}
                      max={100_000}
                      placeholder="(解除)"
                      value={r.limit}
                      onChange={(e) => onChange(kind, { limit: e.target.value })}
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      type="text"
                      placeholder="例: Pro プラン"
                      value={r.notes}
                      onChange={(e) => onChange(kind, { notes: e.target.value })}
                      disabled={disabled}
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
    </section>
  );
}
