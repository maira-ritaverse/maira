"use client";

/**
 * レポート設定フォーム(admin)。
 *
 * ・タブで「目標」と「コスト」を切替
 * ・直近 12 か月をリストで表示、選択した月を編集して保存
 * ・空欄なら 0 として送る
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TargetRow = {
  year_month: string;
  placement_count_target: number;
  net_revenue_target: number;
  application_count_target: number;
  interview_count_target: number;
};

type CostRow = {
  year_month: string;
  marketing_cost: number;
  tool_cost: number;
  personnel_cost: number;
  other_cost: number;
  memo: string | null;
};

type Props = {
  initialTargets: TargetRow[];
  initialCosts: CostRow[];
};

// 直近 12 か月の YYYY-MM を降順で列挙
function last12Months(): string[] {
  const list: string[] = [];
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i < 12; i++) {
    list.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return list;
}

export function ReportSettingsForm({ initialTargets, initialCosts }: Props) {
  const [tab, setTab] = useState<"targets" | "costs">("targets");
  const [targetsList, setTargetsList] = useState(initialTargets);
  const [costsList, setCostsList] = useState(initialCosts);
  const months = last12Months();

  return (
    <div className="space-y-3">
      <div className="inline-flex overflow-hidden rounded border">
        <button
          type="button"
          onClick={() => setTab("targets")}
          className={`px-4 py-1.5 text-xs ${
            tab === "targets"
              ? "bg-emerald-500 text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          月次目標
        </button>
        <button
          type="button"
          onClick={() => setTab("costs")}
          className={`px-4 py-1.5 text-xs ${
            tab === "costs"
              ? "bg-emerald-500 text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          月次コスト(ROI)
        </button>
      </div>

      {tab === "targets" ? (
        <TargetsTab months={months} rows={targetsList} onUpdate={setTargetsList} />
      ) : (
        <CostsTab months={months} rows={costsList} onUpdate={setCostsList} />
      )}
    </div>
  );
}

function TargetsTab({
  months,
  rows,
  onUpdate,
}: {
  months: string[];
  rows: TargetRow[];
  onUpdate: (next: TargetRow[]) => void;
}) {
  const [selected, setSelected] = useState(months[0]);
  const existing = rows.find((r) => r.year_month === selected);
  const [pc, setPc] = useState(existing?.placement_count_target ?? 0);
  const [nr, setNr] = useState(existing?.net_revenue_target ?? 0);
  const [ac, setAc] = useState(existing?.application_count_target ?? 0);
  const [ic, setIc] = useState(existing?.interview_count_target ?? 0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function pickMonth(m: string) {
    setSelected(m);
    const row = rows.find((r) => r.year_month === m);
    setPc(row?.placement_count_target ?? 0);
    setNr(row?.net_revenue_target ?? 0);
    setAc(row?.application_count_target ?? 0);
    setIc(row?.interview_count_target ?? 0);
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/agency/reports/targets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          year_month: selected,
          placement_count_target: pc,
          net_revenue_target: nr,
          application_count_target: ac,
          interview_count_target: ic,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setMsg(`保存失敗: ${b.message ?? b.error ?? res.status}`);
        return;
      }
      setMsg("保存しました");
      const row: TargetRow = {
        year_month: selected,
        placement_count_target: pc,
        net_revenue_target: nr,
        application_count_target: ac,
        interview_count_target: ic,
      };
      const idx = rows.findIndex((r) => r.year_month === selected);
      const next = idx >= 0 ? rows.map((r, i) => (i === idx ? row : r)) : [...rows, row];
      onUpdate(next);
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
      <MonthPicker months={months} selected={selected} onSelect={pickMonth} />
      <div className="space-y-3 rounded border p-4">
        <div className="text-sm font-medium">{selected} の目標</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <NumRow label="成約件数" value={pc} onChange={setPc} />
          <NumRow label="純売上(円)" value={nr} onChange={setNr} step={10000} />
          <NumRow label="応募件数" value={ac} onChange={setAc} />
          <NumRow label="面談件数" value={ic} onChange={setIc} />
        </div>
        <SaveRow msg={msg} saving={saving} onSave={save} />
      </div>
    </div>
  );
}

function CostsTab({
  months,
  rows,
  onUpdate,
}: {
  months: string[];
  rows: CostRow[];
  onUpdate: (next: CostRow[]) => void;
}) {
  const [selected, setSelected] = useState(months[0]);
  const existing = rows.find((r) => r.year_month === selected);
  const [mk, setMk] = useState(existing?.marketing_cost ?? 0);
  const [tl, setTl] = useState(existing?.tool_cost ?? 0);
  const [ps, setPs] = useState(existing?.personnel_cost ?? 0);
  const [ot, setOt] = useState(existing?.other_cost ?? 0);
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function pickMonth(m: string) {
    setSelected(m);
    const row = rows.find((r) => r.year_month === m);
    setMk(row?.marketing_cost ?? 0);
    setTl(row?.tool_cost ?? 0);
    setPs(row?.personnel_cost ?? 0);
    setOt(row?.other_cost ?? 0);
    setMemo(row?.memo ?? "");
    setMsg(null);
  }

  const total = mk + tl + ps + ot;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/agency/reports/costs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          year_month: selected,
          marketing_cost: mk,
          tool_cost: tl,
          personnel_cost: ps,
          other_cost: ot,
          memo: memo || null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setMsg(`保存失敗: ${b.message ?? b.error ?? res.status}`);
        return;
      }
      setMsg("保存しました");
      const row: CostRow = {
        year_month: selected,
        marketing_cost: mk,
        tool_cost: tl,
        personnel_cost: ps,
        other_cost: ot,
        memo: memo || null,
      };
      const idx = rows.findIndex((r) => r.year_month === selected);
      const next = idx >= 0 ? rows.map((r, i) => (i === idx ? row : r)) : [...rows, row];
      onUpdate(next);
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
      <MonthPicker months={months} selected={selected} onSelect={pickMonth} />
      <div className="space-y-3 rounded border p-4">
        <div className="text-sm font-medium">{selected} のコスト</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <NumRow label="マーケティング(広告費 等)" value={mk} onChange={setMk} step={10000} />
          <NumRow label="ツール(Maira / Zoom 等)" value={tl} onChange={setTl} step={1000} />
          <NumRow label="人件費" value={ps} onChange={setPs} step={10000} />
          <NumRow label="その他" value={ot} onChange={setOt} step={1000} />
        </div>
        <div className="text-muted-foreground text-xs">
          合計:¥{total.toLocaleString("ja-JP")} 円
        </div>
        <div className="space-y-1">
          <Label htmlFor="cost-memo">メモ(任意・内訳の備忘)</Label>
          <textarea
            id="cost-memo"
            className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={2000}
          />
        </div>
        <SaveRow msg={msg} saving={saving} onSave={save} />
      </div>
    </div>
  );
}

function MonthPicker({
  months,
  selected,
  onSelect,
}: {
  months: string[];
  selected: string;
  onSelect: (m: string) => void;
}) {
  return (
    <div className="space-y-0.5 rounded border p-2 text-sm">
      <p className="text-muted-foreground mb-1 text-xs font-semibold">月を選ぶ</p>
      {months.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onSelect(m)}
          className={`block w-full rounded px-2 py-1 text-left text-xs ${
            selected === m
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function NumRow({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
      />
    </div>
  );
}

function SaveRow({
  msg,
  saving,
  onSave,
}: {
  msg: string | null;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t pt-2">
      {msg && <span className="text-muted-foreground text-xs">{msg}</span>}
      <Button disabled={saving} onClick={onSave}>
        {saving ? "保存中..." : "保存"}
      </Button>
    </div>
  );
}
