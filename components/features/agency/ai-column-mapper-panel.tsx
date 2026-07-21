"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * CSV ヘッダー → Myaira 標準カラム の AI マッピング パネル
 *
 * 役割:
 *   ・CSV パース後の ヘッダー / サンプル を /api/agency/import/ai-map に 投げ、
 *     AI 提案 マッピングを 表で 表示。
 *   ・ユーザーは 各行の <select> で 標準カラムを 上書き 可能(canonical = "" で 無視)。
 *   ・「適用」ボタンで onApply(canonicalRows) を 呼び出し、親 ダイアログが 既存
 *     import API へ POST する 流れ。
 *
 * 既存の HEADER_ALIASES が 通る ヘッダーは AI 側でも confidence="high" + 完全一致で
 * 返ってくる はず(prompt + sanitize 経路で 保証)。誤マッピングの 救済は 手動 select で。
 */

type CanonicalColumn = {
  key: string;
  label: string;
  required: boolean;
};

export type AiMappingRow = {
  csvHeader: string;
  canonical: string | null;
  confidence: "high" | "medium" | "low";
  reason: string | null;
};

type AiMapResponse = {
  mappings: AiMappingRow[];
  canonicalColumns: CanonicalColumn[];
  error?: string;
  message?: string;
};

type Props = {
  target: "clients" | "jobs";
  csvHeaders: string[];
  // フル行を 渡す:パネル内部で 先頭 3 行 / 各セル 30 字に 圧縮して API に 投げる。
  parsedRows: ReadonlyArray<Record<string, string>>;
  // 「適用」を 押した 時に 親が 受け取る ハンドラ。引数は canonical キーに 変換された 全行。
  onApply: (canonicalRows: Record<string, string>[]) => void;
  // キャンセル時に 親が 状態を 戻す ためのハンドラ(任意)。
  onCancel?: () => void;
};

const CELL_TRIM = 30;
const SAMPLE_ROWS = 3;

function trimCell(v: string): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length > CELL_TRIM ? t.slice(0, CELL_TRIM) + "…" : t;
}

export function AiColumnMapperPanel({ target, csvHeaders, parsedRows, onApply, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canonicalColumns, setCanonicalColumns] = useState<CanonicalColumn[]>([]);
  const [rows, setRows] = useState<AiMappingRow[]>([]);

  const fetchMapping = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sample = parsedRows.slice(0, SAMPLE_ROWS).map((r) => {
        const out: Record<string, string> = {};
        for (const h of csvHeaders) out[h] = trimCell(r[h] ?? "");
        return out;
      });
      const res = await fetch("/api/agency/import/ai-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, headers: csvHeaders, sampleRows: sample }),
      });
      const data = (await res.json()) as AiMapResponse;
      if (!res.ok || !data.mappings) {
        throw new Error(data.message ?? data.error ?? "マッピング 提案 に 失敗しました");
      }
      setCanonicalColumns(data.canonicalColumns);
      setRows(data.mappings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [csvHeaders, parsedRows, target]);

  // マウント時に 1 度だけ AI 呼出を 走らせる(set-state-in-effect 警告回避のため ref ガード)。
  // 再取得は「再提案 / 再試行」ボタンから 明示的に 呼ぶ。
  const didFetchRef = useRef(false);
  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    void fetchMapping();
  }, [fetchMapping]);

  const retry = () => {
    void fetchMapping();
  };

  const setCanonical = (index: number, canonical: string) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? { ...r, canonical: canonical || null, confidence: "high", reason: "手動修正" }
          : r,
      ),
    );
  };

  // 同じ canonical に 2 つ以上 マッピングされていたら 警告(UI で 強調)。
  const duplicateCanonicals = new Set<string>();
  {
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.canonical) continue;
      if (seen.has(r.canonical)) duplicateCanonicals.add(r.canonical);
      seen.add(r.canonical);
    }
  }

  // 必須カラムが マップ されていない 場合は 警告。
  const requiredKeys = canonicalColumns.filter((c) => c.required).map((c) => c.key);
  const mappedCanonicals = new Set(rows.map((r) => r.canonical).filter(Boolean) as string[]);
  const missingRequired = requiredKeys.filter((k) => !mappedCanonicals.has(k));

  const applyDisabled = duplicateCanonicals.size > 0 || missingRequired.length > 0;

  const handleApply = () => {
    // CSV 1 行 を canonical キー に 書き換える。canonical=null の ヘッダーは 捨てる。
    const indexByHeader = new Map(rows.map((r) => [r.csvHeader, r.canonical] as const));
    const converted: Record<string, string>[] = parsedRows.map((row) => {
      const out: Record<string, string> = {};
      for (const [csvKey, value] of Object.entries(row)) {
        const canonical = indexByHeader.get(csvKey);
        if (canonical) out[canonical] = value;
      }
      return out;
    });
    onApply(converted);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/40 p-4 text-sm text-amber-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        AI で カラムを マッピング中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-4">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button type="button" onClick={retry} variant="outline">
            再試行
          </Button>
          {onCancel && (
            <Button type="button" onClick={onCancel} variant="outline">
              キャンセル
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Sparkles className="h-4 w-4" />
        AI カラム マッピング 提案
      </div>
      <p className="text-xs text-amber-900/80">
        AI が CSV ヘッダーと 標準カラムの 対応を 提案しました。確認 / 修正の 上 「適用」を 押すと、
        マッピング 結果で 取り込みを 実行します。「対応 標準カラムなし」を 選んだ ヘッダーは
        取り込み時に 無視されます。
      </p>

      {missingRequired.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            必須カラムが マッピング されていません:{" "}
            {missingRequired
              .map((k) => canonicalColumns.find((c) => c.key === k)?.label ?? k)
              .join(" / ")}
          </AlertDescription>
        </Alert>
      )}
      {duplicateCanonicals.size > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            同じ標準カラムに 複数 ヘッダーが 紐付いて います: {[...duplicateCanonicals].join(" / ")}
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-md ring-1 ring-amber-200/60">
        <table className="min-w-full bg-white text-xs">
          <thead className="bg-amber-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">CSV ヘッダー</th>
              <th className="px-2 py-1.5 text-left font-medium">標準カラム</th>
              <th className="px-2 py-1.5 text-left font-medium">確信度</th>
              <th className="px-2 py-1.5 text-left font-medium">根拠</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isDup = r.canonical && duplicateCanonicals.has(r.canonical);
              return (
                <tr key={`${r.csvHeader}-${i}`} className="border-t border-amber-100/80">
                  <td className="px-2 py-1.5 align-top font-mono whitespace-nowrap">
                    {r.csvHeader}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <select
                      value={r.canonical ?? ""}
                      onChange={(e) => setCanonical(i, e.target.value)}
                      className={`w-full rounded border bg-white px-1.5 py-1 text-xs ${
                        isDup ? "border-red-400" : "border-amber-200"
                      }`}
                    >
                      <option value="">— 対応 標準カラムなし(取り込まない)—</option>
                      {canonicalColumns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                          {c.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap">
                    <ConfidenceBadge level={r.confidence} />
                  </td>
                  <td className="px-2 py-1.5 align-top text-amber-900/70">{r.reason ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
        )}
        <Button type="button" variant="outline" onClick={retry}>
          再提案
        </Button>
        <Button type="button" onClick={handleApply} disabled={applyDisabled}>
          マッピングを 適用
        </Button>
      </div>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const cls =
    level === "high"
      ? "bg-emerald-100 text-emerald-800"
      : level === "medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  const label = level === "high" ? "高" : level === "medium" ? "中" : "低";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>;
}
