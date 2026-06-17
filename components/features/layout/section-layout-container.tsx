"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  HEADER_COLORS,
  defaultSectionLayout,
  loadSectionLayout,
  reorderSectionTo,
  saveSectionLayout,
  sectionsInColumn,
  setSectionColumn,
  setSectionHeaderColor,
  toggleLayoutMode,
  type HeaderColor,
  type SectionLayout,
} from "@/lib/layout/section-order";

type Props = {
  /** localStorage キー(ページごとにユニーク。例:"agency-client-detail")*/
  storageKey: string;
  /** セクションのデフォルト並び順(sectionId の配列) */
  defaultOrder: string[];
  /** sectionId → 中身の ReactNode のマップ */
  sections: Record<string, ReactNode>;
  /** sectionId → 大きく表示するタイトル文字列 */
  titles: Record<string, string>;
};

/**
 * 各 HeaderColor → タイトルバーの Tailwind クラス。
 * 「ピンク・水色」など彩度高め過ぎる色は避け、薄く落ち着いたパステル系で統一。
 */
const HEADER_COLOR_CLASS: Record<HeaderColor, string> = {
  default: "bg-muted/60 text-foreground",
  blue: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100",
  emerald: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
  rose: "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-100",
  purple: "bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-100",
  slate: "bg-slate-200 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100",
};

const HEADER_COLOR_LABEL: Record<HeaderColor, string> = {
  default: "標準",
  blue: "ブルー",
  emerald: "グリーン",
  amber: "アンバー",
  rose: "ローズ",
  purple: "パープル",
  slate: "スレート",
};

/**
 * タイトル背景色のピッカーポップオーバー。
 *
 * 設計:
 *   - 各色は「実際のタイトルバーと同じ背景色 + ラベル」のプレビュー風カードで表示
 *     (ユーザは適用後の見た目をその場で確認できる)
 *   - 選択中の色は左にチェックマーク + 太い枠で明示
 *   - hover で枠が emerald に光る
 *   - 横 1 列で並べてリスト的に。狭い popover に押し込まず適度な幅(w-44)
 */
function ColorPickerPopover({
  currentColor,
  onSelect,
}: {
  currentColor: HeaderColor;
  onSelect: (c: HeaderColor) => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="タイトル背景色を選ぶ"
      className="bg-popover text-popover-foreground absolute top-9 right-0 z-30 w-44 rounded-md border p-1.5 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-muted-foreground px-1.5 pt-0.5 pb-1 text-[10px] font-medium tracking-wide uppercase">
        タイトル背景色
      </p>
      <ul className="space-y-0.5" role="listbox" aria-label="色の選択肢">
        {HEADER_COLORS.map((c) => {
          const selected = c === currentColor;
          return (
            <li key={c}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(c);
                }}
                draggable={false}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:ring-2 hover:ring-emerald-400/60 ${HEADER_COLOR_CLASS[c]} ${
                  selected ? "ring-foreground/30 ring-2" : ""
                }`}
              >
                {/* 選択中チェック(全行で固定幅を取って横揃え) */}
                <span className="flex w-3 shrink-0 items-center justify-center">
                  {selected && <Check className="h-3 w-3" />}
                </span>
                <span className="flex-1 font-semibold">{HEADER_COLOR_LABEL[c]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * セクション(カード)を DnD で並び替えできる + タイトルバー付きコンテナ。
 *
 * 機能:
 *   - 各セクションは大きなタイトルバー(`titles[id]`)で区切られる
 *   - 編集モード ON で:
 *       - ドラッグハンドル表示 + DnD で並び替え
 *       - タイトル背景色を 7 プリセットから選択(セクションごと)
 *       - 1 列 ↔ 2 列の切替
 *       - 「→ 右列へ / ← 左列へ」で 2 列モード時のカラム移動
 *   - 設定は localStorage に per-page で永続化
 *   - レスポンシブ:lg(>=1024px)以上で 2 列、それ未満は強制 1 列
 */
export function SectionLayoutContainer({ storageKey, defaultOrder, sections, titles }: Props) {
  const [layout, setLayout] = useState<SectionLayout>(() => defaultSectionLayout(defaultOrder));
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [colorPickerOpenFor, setColorPickerOpenFor] = useState<string | null>(null);

  // マウント時に localStorage から復元
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLayout(loadSectionLayout(storageKey, defaultOrder));
  }, [storageKey, defaultOrder]);

  // 変更を永続化
  useEffect(() => {
    if (!loadedRef.current) return;
    saveSectionLayout(storageKey, layout);
  }, [storageKey, layout]);

  // ─── DnD ハンドラ ─────────────────────────────────────────
  const handleDragStart = (id: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing) return;
    setDragId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (id: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hoverId !== id) setHoverId(id);
  };
  const handleDrop = (targetId: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !dragId) return;
    e.preventDefault();
    const fromIdx = layout.order.indexOf(dragId);
    const toIdx = layout.order.indexOf(targetId);
    if (fromIdx >= 0 && toIdx >= 0) {
      let next = reorderSectionTo(layout, fromIdx, toIdx);
      if (next.mode === "2col") {
        const targetColumn = layout.columns[targetId];
        next = setSectionColumn(next, dragId, targetColumn);
      }
      setLayout(next);
    }
    setDragId(null);
    setHoverId(null);
  };
  const handleDragEnd = () => {
    setDragId(null);
    setHoverId(null);
  };

  // ─── 描画 ─────────────────────────────────────────────────
  const renderSection = (id: string) => {
    const isDragging = dragId === id;
    const isHover = hoverId === id && dragId !== null && dragId !== id;
    const col = layout.columns[id];
    const color = layout.headerColors[id] ?? "default";
    const title = titles[id] ?? id;

    return (
      <div
        key={id}
        draggable={editing}
        onDragStart={handleDragStart(id)}
        onDragOver={handleDragOver(id)}
        onDrop={handleDrop(id)}
        onDragEnd={handleDragEnd}
        className={`group bg-card relative overflow-hidden rounded-lg border transition-all ${
          isDragging ? "opacity-40" : ""
        } ${
          isHover ? "shadow-[0_0_0_2px_rgba(16,185,129,1)]" : ""
        } ${editing ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {/* 大きなタイトルバー */}
        <div
          className={`flex items-center justify-between gap-2 border-b px-4 py-2.5 ${HEADER_COLOR_CLASS[color]}`}
        >
          <h2 className="flex items-center gap-2 text-base font-bold tracking-wide select-none">
            {editing && (
              <span className="opacity-60" aria-hidden>
                ⠿
              </span>
            )}
            {title}
          </h2>

          {editing && (
            <div className="flex items-center gap-1.5">
              {/* 色ピッカートリガー:現在の色を絵柄として持つ pill ボタン */}
              <div className="relative">
                <button
                  type="button"
                  aria-label={`${title} のタイトル背景色を変更`}
                  aria-haspopup="dialog"
                  aria-expanded={colorPickerOpenFor === id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerOpenFor((prev) => (prev === id ? null : id));
                  }}
                  draggable={false}
                  className="border-input bg-background/80 hover:bg-background flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition"
                >
                  <span
                    aria-hidden
                    className={`inline-block h-3.5 w-3.5 rounded-full border ${
                      HEADER_COLOR_CLASS[color].split(" ")[0]
                    } ${color === "default" ? "border-foreground/30" : "border-foreground/20"}`}
                  />
                  <span>色</span>
                  <span className="text-muted-foreground" aria-hidden>
                    ▾
                  </span>
                </button>
                {colorPickerOpenFor === id && (
                  <ColorPickerPopover
                    currentColor={color}
                    onSelect={(c) => {
                      setLayout((l) => setSectionHeaderColor(l, id, c));
                      setColorPickerOpenFor(null);
                    }}
                  />
                )}
              </div>
              {/* 列移動ボタン(2col のみ) */}
              {layout.mode === "2col" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLayout((l) => setSectionColumn(l, id, col === 1 ? 2 : 1));
                  }}
                  draggable={false}
                >
                  {col === 1 ? "→ 右列へ" : "← 左列へ"}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* セクション本体 */}
        <div className="p-3">{sections[id] ?? null}</div>
      </div>
    );
  };

  const col1 = sectionsInColumn(layout, 1).filter((id) => id in sections);
  const col2 = sectionsInColumn(layout, 2).filter((id) => id in sections);
  const showTwoCol = layout.mode === "2col";

  return (
    <div className="space-y-3" onClick={() => setColorPickerOpenFor(null)}>
      {/* 編集ツールバー */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLayout((l) => toggleLayoutMode(l))}
            >
              {layout.mode === "1col" ? "🔀 2 列にする" : "↩ 1 列に戻す"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!confirm("レイアウトを初期状態に戻しますか?")) return;
                setLayout(defaultSectionLayout(defaultOrder));
              }}
            >
              初期化
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant={editing ? "default" : "ghost"}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "編集完了" : "レイアウト編集"}
        </Button>
      </div>

      {/* 本体:2col モードは lg 以上で 2 列、それ未満は強制 1 列縮退 */}
      {showTwoCol ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">{col1.map(renderSection)}</div>
          <div className="space-y-4">{col2.map(renderSection)}</div>
        </div>
      ) : (
        <div className="space-y-4">
          {layout.order.filter((id) => id in sections).map(renderSection)}
        </div>
      )}
    </div>
  );
}
