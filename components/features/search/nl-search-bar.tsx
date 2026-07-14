"use client";

/**
 * 自然文検索バー (Tier 4 プロト)。
 *
 * 求人管理 / クライアント管理の一覧画面で共用する。
 *
 * 挙動:
 *   - トグル OFF: 従来の検索欄と同じ (入力を親に渡すだけ)。
 *   - トグル ON: Enter で /api/agency/search/nl-parse に投げ、AI 解釈の
 *     フィルタを親に返す + チップで解釈内容を可視化する。
 *     チップを × すると個別に外れて、フィルタ状態が親側で更新される。
 *   - AI エラー時はトグル OFF 時と同じ従来検索にフォールバック
 *     (入力文字列をそのまま searchQuery として親に渡す)。
 *
 * 設計:
 *   - 汎用化のためにフィルタ型を Record<string, unknown> で受け、チップ生成は
 *     親から renderChips 関数で受け取る。
 */

import { useState } from "react";
import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type NlSearchChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

type Props<TFilters> = {
  /** 従来検索の入力値 (トグル OFF 時に使う) */
  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
  placeholder: string;
  /** AI 検索モードで送信する resource 種別 */
  resource: "jobs" | "clients";
  /** AI 検索モードの入力プレースホルダ */
  aiPlaceholder: string;
  /** AI 解釈済みの現在フィルタ (チップ生成の元) */
  currentFilters: TFilters;
  /** AI 解釈結果を親に流し込む (親側で複数の setState を呼ぶ) */
  onApplyAiFilters: (filters: TFilters) => void;
  /** currentFilters からチップ配列を作る (未指定は表示なし) */
  renderChips: (filters: TFilters) => NlSearchChip[];
};

export function NlSearchBar<TFilters>({
  searchQuery,
  onSearchQueryChange,
  placeholder,
  resource,
  aiPlaceholder,
  currentFilters,
  onApplyAiFilters,
  renderChips,
}: Props<TFilters>) {
  const [aiMode, setAiMode] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chips = aiMode ? renderChips(currentFilters) : [];

  const runAi = async () => {
    const query = aiInput.trim();
    if (query.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/search/nl-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, query }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        filters?: TFilters;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.filters) {
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      }
      onApplyAiFilters(json.filters);
    } catch (err) {
      // AI 失敗時は「入力文字列を従来検索の searchQuery に流す」フォールバック。
      // ユーザー体験を止めない。
      onSearchQueryChange(query);
      setError(err instanceof Error ? err.message : "AI 検索に失敗しました");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {aiMode ? (
          <>
            <Input
              placeholder={aiPlaceholder}
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runAi();
                }
              }}
              className="max-w-md"
              disabled={pending}
            />
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => void runAi()}
              disabled={pending || aiInput.trim().length === 0}
            >
              {pending ? "解釈中…" : "AI で解釈"}
            </Button>
          </>
        ) : (
          <Input
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="max-w-xs"
          />
        )}
        <Button
          type="button"
          size="sm"
          variant={aiMode ? "default" : "outline"}
          onClick={() => {
            setAiMode((prev) => !prev);
            setError(null);
          }}
          title={aiMode ? "従来検索に戻す" : "自然文で AI に絞り込ませる"}
        >
          <SparklesIcon className="mr-1 h-3.5 w-3.5" />
          {aiMode ? "AI 検索 ON" : "AI 検索"}
        </Button>
      </div>

      {aiMode && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">AI 解釈:</span>
          {chips.map((c) => (
            <span
              key={c.key}
              className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            >
              {c.label}
              <button
                type="button"
                onClick={c.onRemove}
                className="opacity-60 hover:opacity-100"
                aria-label={`${c.label} を外す`}
                title="このフィルタを外す"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {aiMode && error && (
        <p className="text-xs text-red-600 dark:text-red-300">
          {error} — 従来検索にフォールバックしました。
        </p>
      )}
    </div>
  );
}
