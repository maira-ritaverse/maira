"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  SALES_STAGE_KEYS,
  SALES_STAGE_LABEL,
  SALES_STAGES,
  type SalesProspect,
  type SalesStage,
} from "@/lib/sales/types";

/** ステージのバッジ色。受注=緑 / 失注=赤 / トライアル・提案=琥珀 / その他=灰。 */
export function stageBadgeClass(stage: SalesStage): string {
  if (stage === "won") return "bg-emerald-100 text-emerald-800";
  if (stage === "lost") return "bg-red-100 text-red-700";
  if (stage === "trial" || stage === "proposal") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function DealsClient({ initialProspects }: { initialProspects: SalesProspect[] }) {
  const [prospects, setProspects] = useState<SalesProspect[]>(initialProspects);
  const [showCreate, setShowCreate] = useState(false);
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [stage, setStage] = useState<SalesStage>("lead");
  const [stageFilter, setStageFilter] = useState<SalesStage | "all">("all");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!company.trim()) {
      setError("会社名を入力してください");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: company.trim(),
          contact_name: contactName.trim() || null,
          contact_email: contactEmail.trim() || null,
          stage,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        prospect?: SalesProspect;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.prospect)
        throw new Error(json.message ?? json.error ?? "作成に失敗しました");
      setProspects((prev) => [json.prospect!, ...prev]);
      setShowCreate(false);
      setCompany("");
      setContactName("");
      setContactEmail("");
      setStage("lead");
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const shown =
    stageFilter === "all" ? prospects : prospects.filter((p) => p.stage === stageFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">{shown.length} 件</span>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as SalesStage | "all")}
            className="border-input bg-background rounded-md border px-2 py-1 text-sm"
          >
            <option value="all">全ステージ</option>
            {SALES_STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          + 新規商談
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {showCreate && (
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-medium">新規商談</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              placeholder="会社名(必須)"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={200}
            />
            <Input
              placeholder="担当者名"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              maxLength={100}
            />
            <Input
              placeholder="メールアドレス"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              maxLength={254}
            />
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as SalesStage)}
              className="border-input bg-background rounded-md border px-2 py-1 text-sm"
            >
              {SALES_STAGE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SALES_STAGE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={create} disabled={creating}>
              {creating ? "作成中…" : "作成"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">会社名</th>
              <th className="px-4 py-3 font-medium">担当者</th>
              <th className="px-4 py-3 font-medium">ステージ</th>
              <th className="px-4 py-3 font-medium">更新日</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
                  まだ商談はありません。「+ 新規商談」から追加してください。
                </td>
              </tr>
            ) : (
              shown.map((p) => (
                <tr key={p.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{p.companyName}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {p.contactName ?? "—"}
                    {p.contactEmail && (
                      <div className="text-xs text-slate-500">{p.contactEmail}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${stageBadgeClass(p.stage)}`}
                    >
                      {SALES_STAGE_LABEL[p.stage]}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-600">
                    {fmtDate(p.updatedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/deals/${p.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      開く
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
