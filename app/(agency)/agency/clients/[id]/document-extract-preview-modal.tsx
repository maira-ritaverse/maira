"use client";

/**
 * 元書類 (PDF / 画像) を AI で 抽出 → 差分 プレビュー → 選択項目 のみ を
 * client_records に PATCH する モーダル。
 *
 * フロー:
 *   1) マウント時 に POST /api/agency/clients/[id]/source-documents/[docId]/extract
 *      を 呼び、 { extracted, current, extractionNotes, confidence } を 受け取る
 *   2) 各 フィールド キー ごと に 現在値 / 抽出値 を 並べ、 差分 が ある 行 は
 *      チェックボックス を 初期 ON、 差分 が ない 行 は OFF + グレー
 *   3) 「選択項目 を 保存」 → 選ばれた キー だけ PATCH /api/agency/clients/[id] に 送信
 *   4) 成功 → onSaved(count) で 呼び出し 元 に 通知 (親 が toast + 再フェッチ 等)
 *
 * 設計理由:
 *   ・AI が 顔 (プロフィール で は 氏名 / 住所 等) を 誤って 書き 換える 事故 を 避け、
 *     必ず ユーザー が 明示的 に チェック を 外せる UX を 提供
 *   ・保存 パス は 既存 PATCH /api/agency/clients/[id] の 1 本 に 揃え、 更新履歴 や
 *     暗号化 ロジック を 一元化 (この モーダル 側 で は 何も 特別 な こと を しない)
 */
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/admin/toast/store";
import {
  CLIENT_EXTRACTION_FIELD_KEYS,
  CLIENT_EXTRACTION_FIELD_LABELS,
  type ClientExtractionFieldKey,
} from "@/lib/ai/prompts/client-extract-from-document";
import {
  clientEmploymentTypeLabels,
  clientFinalEducationLabels,
  clientGenderLabels,
  clientJobChangeTimingLabels,
  clientMaritalStatusLabels,
} from "@/lib/clients/types";

type Props = {
  clientRecordId: string;
  docId: string;
  fileName: string;
  onClose: () => void;
  /** 保存 成功 時 に 呼ばれる。 引数 = 実際 に 上書き した フィールド 数。 */
  onSaved: (updatedCount: number) => void;
};

type ExtractResponse = {
  extracted: Record<string, unknown>;
  current: Record<string, unknown>;
  extractionNotes: string;
  confidence: "high" | "medium" | "low";
};

type Stage = "processing" | "ready" | "saving" | "error";

// enum 値 → 日本語 ラベル 変換 (表示用)。 undefined / 未 マッチ は そのまま 返す。
const ENUM_LABELS: Partial<Record<ClientExtractionFieldKey, Record<string, string>>> = {
  gender: clientGenderLabels,
  marital_status: clientMaritalStatusLabels,
  current_employment_type: clientEmploymentTypeLabels,
  final_education: clientFinalEducationLabels,
  job_change_timing: clientJobChangeTimingLabels,
};

function displayValue(key: ClientExtractionFieldKey, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value === "") return "";
    const labels = ENUM_LABELS[key];
    if (labels && labels[value]) return labels[value];
    return value;
  }
  return String(value);
}

/**
 * 差分 判定。 空 vs 空 / 同一 値 は 「差分 なし」 と 見なす。
 * 配列 は 要素 の 集合 が 同じ なら 差分 なし (順序 は 無視 する = 業種 / 職種 タグ の
 * 順序 は 意味 が 薄い ため)。
 */
function hasDiff(current: unknown, extracted: unknown): boolean {
  const c = current ?? "";
  const e = extracted ?? "";
  if (Array.isArray(c) || Array.isArray(e)) {
    const ca = Array.isArray(c) ? c : [];
    const ea = Array.isArray(e) ? e : [];
    if (ca.length === 0 && ea.length === 0) return false;
    if (ca.length !== ea.length) return true;
    const cs = new Set(ca.map(String));
    return ea.some((v) => !cs.has(String(v)));
  }
  return String(c) !== String(e);
}

const CONFIDENCE_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const CONFIDENCE_TONE: Record<"high" | "medium" | "low", string> = {
  high: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
  medium:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  low: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
};

export function DocumentExtractPreviewModal({
  clientRecordId,
  docId,
  fileName,
  onClose,
  onSaved,
}: Props) {
  const { showToast } = useToast();
  const [stage, setStage] = useState<Stage>("processing");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractResponse | null>(null);
  const [checked, setChecked] = useState<Set<ClientExtractionFieldKey>>(new Set());

  // マウント時 に 1 回 だけ 抽出 API を 叩く。 二重 呼出 防止 の 為 cleanup で キャンセル。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/agency/clients/${clientRecordId}/source-documents/${docId}/extract`,
          { method: "POST" },
        );
        const body = (await res.json().catch(() => ({}))) as Partial<ExtractResponse> & {
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(body.message ?? body.error ?? `AI 抽出に失敗 (HTTP ${res.status})`);
        }
        if (cancelled) return;
        const parsed: ExtractResponse = {
          extracted: body.extracted ?? {},
          current: body.current ?? {},
          extractionNotes: body.extractionNotes ?? "",
          confidence: (body.confidence as "high" | "medium" | "low") ?? "medium",
        };
        // 差分 が ある 行 だけ 初期 チェック ON
        const initialChecked = new Set<ClientExtractionFieldKey>();
        for (const key of CLIENT_EXTRACTION_FIELD_KEYS) {
          if (hasDiff(parsed.current[key], parsed.extracted[key])) {
            initialChecked.add(key);
          }
        }
        setData(parsed);
        setChecked(initialChecked);
        setStage("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientRecordId, docId]);

  // 行 の チェック 切替 / 一括 操作 用
  const rowsWithDiff = useMemo(() => {
    if (!data) return new Set<ClientExtractionFieldKey>();
    const s = new Set<ClientExtractionFieldKey>();
    for (const key of CLIENT_EXTRACTION_FIELD_KEYS) {
      if (hasDiff(data.current[key], data.extracted[key])) s.add(key);
    }
    return s;
  }, [data]);

  const toggle = (key: ClientExtractionFieldKey) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllDiff = () => setChecked(new Set(rowsWithDiff));
  const selectNone = () => setChecked(new Set());

  async function handleSave() {
    if (!data || checked.size === 0) return;
    setStage("saving");
    setError(null);
    try {
      // 選ばれた キー だけ を PATCH ボディ に 詰める。 空 値 / 空 配列 も
      // 「クリア」意図 と して そのまま 送る (updateClientRequestSchema 側 で
      //  "" は null に 倒され、 空配列 は "クリア" 扱い)。
      const patchBody: Record<string, unknown> = {};
      for (const key of CLIENT_EXTRACTION_FIELD_KEYS) {
        if (!checked.has(key)) continue;
        patchBody[key] = data.extracted[key];
      }

      const res = await fetch(`/api/agency/clients/${clientRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `保存に失敗 (HTTP ${res.status})`);
      }
      onSaved(checked.size);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      showToast("error", msg);
      setStage("ready");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AI 抽出結果の確認"
    >
      <div className="bg-background flex max-h-[90vh] w-full max-w-4xl flex-col gap-4 overflow-hidden rounded-lg border p-5 shadow-lg">
        {/* ヘッダ */}
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="size-4" aria-hidden />
            AI 抽出結果の確認
          </h2>
          <p className="text-muted-foreground text-xs">
            「{fileName}」を AI で読み取りました。
            反映したい項目のチェックを残して「選択項目を保存」を押してください。
          </p>
        </div>

        {/* 本体 */}
        {stage === "processing" && (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 py-16 text-sm">
            <Loader2 className="size-6 animate-spin" aria-hidden />
            AI で読み取り中… (30〜60 秒)
          </div>
        )}

        {stage === "error" && !data && (
          <div className="flex-1 rounded-md border border-red-200 bg-red-50/60 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error ?? "AI 抽出に失敗しました"}
          </div>
        )}

        {data && (
          <>
            {/* 精度バッジ + 一括操作 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 ${CONFIDENCE_TONE[data.confidence]}`}
                >
                  読み取り精度: {CONFIDENCE_LABEL[data.confidence]}
                </span>
                <span className="text-muted-foreground">
                  差分あり {rowsWithDiff.size} 件 / 反映予定 {checked.size} 件
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={selectAllDiff}
                  disabled={stage === "saving"}
                >
                  差分すべて選択
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={selectNone}
                  disabled={stage === "saving"}
                >
                  全て解除
                </Button>
              </div>
            </div>

            {/* 差分テーブル */}
            <div className="flex-1 overflow-y-auto rounded-md border">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left"></th>
                    <th className="w-40 px-3 py-2 text-left font-medium">項目</th>
                    <th className="px-3 py-2 text-left font-medium">現在値</th>
                    <th className="px-3 py-2 text-left font-medium">AI 抽出値</th>
                  </tr>
                </thead>
                <tbody>
                  {CLIENT_EXTRACTION_FIELD_KEYS.map((key) => {
                    const diff = rowsWithDiff.has(key);
                    const cur = displayValue(key, data.current[key]);
                    const ext = displayValue(key, data.extracted[key]);
                    const isChecked = checked.has(key);
                    return (
                      <tr key={key} className={diff ? "border-t" : "border-t opacity-60"}>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(key)}
                            disabled={stage === "saving"}
                            aria-label={`${CLIENT_EXTRACTION_FIELD_LABELS[key]} を反映`}
                            className="mt-0.5 size-4 cursor-pointer"
                          />
                        </td>
                        <td className="text-muted-foreground px-3 py-2 align-top text-xs">
                          {CLIENT_EXTRACTION_FIELD_LABELS[key]}
                        </td>
                        <td className="text-muted-foreground px-3 py-2 align-top text-xs break-words whitespace-pre-wrap">
                          {cur || <span className="text-muted-foreground/50">(未入力)</span>}
                        </td>
                        <td className="px-3 py-2 align-top text-xs">
                          {ext ? (
                            <span className={diff ? "font-medium" : ""}>{ext}</span>
                          ) : (
                            <span className="text-muted-foreground/50">(未抽出)</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* AI メモ */}
            {data.extractionNotes && (
              <details className="rounded-md border p-3 text-xs">
                <summary className="cursor-pointer font-medium">AI の読み取りメモ</summary>
                <pre className="text-muted-foreground mt-2 font-sans whitespace-pre-wrap">
                  {data.extractionNotes}
                </pre>
              </details>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50/60 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
          </>
        )}

        {/* フッタ */}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={stage === "saving"}>
            キャンセル
          </Button>
          {stage === "error" && !data && (
            <Button variant="outline" onClick={onClose}>
              閉じる
            </Button>
          )}
          {data && (
            <Button
              onClick={() => void handleSave()}
              disabled={stage !== "ready" || checked.size === 0}
            >
              {stage === "saving" ? "保存中…" : `選択項目を保存 (${checked.size})`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
