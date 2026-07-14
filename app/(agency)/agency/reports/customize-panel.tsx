"use client";

/**
 * レポート表示カスタマイズパネル。
 *
 * ・「カスタマイズ」ボタン → サイドシート表示
 * ・各セクションを ↑↓ で並べ替え、目のアイコンで表示/非表示
 * ・保存すると /api/agency/reports/preferences に PUT され、router.refresh() で反映
 * ・「デフォルトに戻す」で並び順・非表示をリセット
 *
 * ロール制限のあるセクション(admin 限定など)は、その権限が無いユーザーには
 * 一覧に出さない(制御しても意味が無いため)。
 *
 * ドラッグ&ドロップは意図的に採用しない:
 *   ・モバイルで扱いにくい / a11y の追加実装が要る / 依存ライブラリを増やしたくない
 *   ・↑↓ ボタンで並び替える方が「並び順を直感的に理解できる」
 */
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiRequest, errorToJapanese } from "@/lib/errors/messages";
import { useToast } from "@/lib/admin/toast/store";

export type SectionMeta = {
  id: string;
  label: string;
  /** admin のみ利用可能なセクションは省略される */
  restrictTo?: "admin";
};

type Props = {
  allSections: SectionMeta[];
  initialOrder: string[];
  initialHidden: string[];
  isAdmin: boolean;
};

export function CustomizePanel({ allSections, initialOrder, initialHidden, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[]>(() =>
    mergeOrder(allSections, initialOrder, isAdmin),
  );
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initialHidden));
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  // 権限で使えるセクションだけに絞る(この画面で操作対象になる集合)
  const usableSections = useMemo(
    () => allSections.filter((s) => !s.restrictTo || (s.restrictTo === "admin" && isAdmin)),
    [allSections, isAdmin],
  );
  const usableIds = useMemo(() => new Set(usableSections.map((s) => s.id)), [usableSections]);

  // order のうち、使える ID だけを画面に並べる
  const displayedOrder = order.filter((id) => usableIds.has(id));

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= displayedOrder.length) return;
    // displayedOrder 内での swap → 元の order へマージし直す
    const next = [...displayedOrder];
    [next[idx], next[target]] = [next[target], next[idx]];
    setOrder(mergeIntoOriginal(order, next, usableIds));
  }

  function toggleHide(id: string) {
    const nextSet = new Set(hidden);
    if (nextSet.has(id)) nextSet.delete(id);
    else nextSet.add(id);
    setHidden(nextSet);
  }

  function reset() {
    setOrder(allSections.map((s) => s.id));
    setHidden(new Set());
  }

  async function save() {
    setSaving(true);
    try {
      await apiRequest("/api/agency/reports/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_order: order,
          hidden_sections: Array.from(hidden),
        }),
      });
      showToast("success", "レポート表示を保存しました");
      router.refresh();
      setOpen(false);
    } catch (e) {
      showToast("error", errorToJapanese(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="mr-1 size-3" aria-hidden />
        カスタマイズ
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden
        >
          <div
            className="bg-background fixed inset-x-2 top-4 z-50 max-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border shadow-xl md:inset-x-auto md:right-4 md:w-100"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="レポートをカスタマイズ"
          >
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <p className="text-sm font-semibold">レポートをカスタマイズ</p>
                <p className="text-muted-foreground text-xs">
                  ↑↓ で並び替え、目のアイコンで表示/非表示
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground rounded p-1"
                aria-label="閉じる"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto p-3">
              {displayedOrder.map((id, idx) => {
                const meta = usableSections.find((s) => s.id === id);
                if (!meta) return null;
                const isHidden = hidden.has(id);
                return (
                  <div
                    key={id}
                    className={`flex items-center gap-2 rounded-md border px-2 py-2 text-sm transition-colors ${
                      isHidden
                        ? "text-muted-foreground bg-muted/40 border-dashed"
                        : "bg-background hover:border-primary/40"
                    }`}
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => move(idx, -1)}
                        disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                        aria-label="上に移動"
                      >
                        <ArrowUp className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(idx, 1)}
                        disabled={idx === displayedOrder.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                        aria-label="下に移動"
                      >
                        <ArrowDown className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    <span className="text-muted-foreground w-5 shrink-0 text-center text-[10px] tabular-nums">
                      {idx + 1}
                    </span>
                    <span
                      className={`flex-1 truncate ${isHidden ? "line-through" : ""}`}
                      title={meta.label}
                    >
                      {meta.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleHide(id)}
                      className="text-muted-foreground hover:text-foreground rounded p-1"
                      aria-label={isHidden ? "表示する" : "非表示にする"}
                    >
                      {isHidden ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 border-t p-3">
              <button
                type="button"
                onClick={reset}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs underline underline-offset-2"
              >
                <RotateCcw className="size-3" aria-hidden />
                デフォルトに戻す
              </button>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={saving} onClick={save}>
                  {saving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * 保存済 order と現在の allSections をマージする。
 *
 * ・stored に無い ID(セクションが増えたケース)は末尾に足す
 * ・stored にあって allSections に無い ID(セクションが消えたケース)は捨てる
 * ・isAdmin=false なら admin 限定 ID を除外
 */
function mergeOrder(all: SectionMeta[], stored: string[], isAdmin: boolean): string[] {
  const permitted = all.filter((s) => !s.restrictTo || (s.restrictTo === "admin" && isAdmin));
  const permittedIds = new Set(permitted.map((s) => s.id));
  const kept = stored.filter((id) => permittedIds.has(id));
  const missing = permitted.filter((s) => !stored.includes(s.id)).map((s) => s.id);
  return [...kept, ...missing];
}

/**
 * displayedOrder(権限で絞った並び)を、元の order 全体に書き戻す。
 * 使えない ID(権限外)は order の相対位置を保持して残す。
 */
function mergeIntoOriginal(
  original: string[],
  displayed: string[],
  usableIds: Set<string>,
): string[] {
  const result: string[] = [];
  let di = 0;
  for (const id of original) {
    if (usableIds.has(id)) {
      result.push(displayed[di]);
      di += 1;
    } else {
      result.push(id);
    }
  }
  // displayed の残り(originalには無かったもの)を末尾に追加
  while (di < displayed.length) {
    result.push(displayed[di]);
    di += 1;
  }
  return result;
}
