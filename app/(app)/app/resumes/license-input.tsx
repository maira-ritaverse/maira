"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { searchLicenses, type LicenseDictionaryItem } from "@/lib/resumes/license-dictionary";

/**
 * 履歴書「免許・資格」欄の資格名 入力欄(オートコンプリート付き)
 *
 * 設計の方針:
 * - 辞書(license-dictionary.ts)から部分一致候補を出すだけ。
 *   AI で推測したり、候補に無い資格を弾いたりはしない(候補は補助に過ぎない)。
 * - react-hook-form 側からは Controller 経由で value/onChange を渡してもらう
 *   想定。register() 系より、選択時の setValue を素直に書ける。
 * - 各行で独立して動くよう、開閉状態はコンポーネント内 state で持つ。
 * - キーボード操作(↑↓Enter Escape)もサポート。
 *
 * 候補ドロップダウンの描画:
 * - 親の <Card> が `overflow-hidden` を持つため、通常の position: absolute
 *   ではカード下端で切れる。そこで createPortal で document.body に描画し、
 *   position: fixed + getBoundingClientRect() で input 直下に配置する。
 * - スクロール/リサイズ中も追従させるよう、開いている間だけイベントを張る。
 */

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
};

// ドロップダウンの配置に使う、入力欄の画面座標。
type AnchorRect = { left: number; top: number; width: number };

export function LicenseInput({ value, onChange, disabled, placeholder, id }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [candidates, setCandidates] = useState<LicenseDictionaryItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  // -1 = キーボードハイライトなし。Enter 確定は highlight >= 0 のときのみ。
  const [highlight, setHighlight] = useState(-1);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  // blur で閉じる際の遅延タイマー。候補クリックを取りこぼさないため少し待つ。
  const blurTimer = useRef<number | undefined>(undefined);

  const recompute = (next: string) => {
    const hits = searchLicenses(next);
    setCandidates(hits);
    setIsOpen(hits.length > 0);
    setHighlight(-1);
  };

  const pick = (name: string) => {
    onChange(name);
    setCandidates([]);
    setIsOpen(false);
    setHighlight(-1);
  };

  // キーボードでハイライトを動かしたとき、対象が見える位置までリストをスクロール。
  // 候補は max-h-72 で切れているので、画面外にハイライトが行くと見失うため。
  useEffect(() => {
    if (highlight < 0 || !listRef.current) return;
    const buttons = listRef.current.querySelectorAll<HTMLButtonElement>("button");
    buttons[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  // 開いている間は input の位置に追従する。capture:true でページ内の
  // 任意のスクロール領域からの scroll イベントも拾える。
  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAnchorRect({ left: r.left, top: r.bottom, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [isOpen]);

  // isOpen は初期 false で、ユーザー操作(focus / 入力)でしか true にならない。
  // つまり Portal が描画されるのは必ずクライアント側なので、SSR 用ガードは不要。
  const dropdown =
    isOpen && candidates.length > 0 && anchorRect
      ? createPortal(
          <ul
            ref={listRef}
            // overflow-hidden の祖先に閉じ込められないよう Portal 経由で body 直下に描画。
            className="bg-popover text-popover-foreground max-h-72 overflow-auto rounded-md border shadow-md"
            style={{
              position: "fixed",
              left: anchorRect.left,
              top: anchorRect.top + 4,
              width: anchorRect.width,
              zIndex: 50,
            }}
            // mousedown の preventDefault で input の blur を抑制し、click を確実に拾う。
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
          >
            {candidates.map((item, i) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => pick(item.name)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                    i === highlight ? "bg-accent text-accent-foreground" : ""
                  }`}
                  role="option"
                  aria-selected={i === highlight}
                >
                  <span className="truncate">{item.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{item.category}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          recompute(e.target.value);
        }}
        onFocus={() => {
          // フォーカス時、既に入力があれば候補を再計算して再表示する。
          if (value) recompute(value);
        }}
        onBlur={() => {
          // 候補クリック(mouseup)より先に blur が走ると click が消えるため
          // 少し遅延させて閉じる。
          if (blurTimer.current) window.clearTimeout(blurTimer.current);
          blurTimer.current = window.setTimeout(() => setIsOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (!isOpen || candidates.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1 >= candidates.length ? 0 : h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h <= 0 ? candidates.length - 1 : h - 1));
          } else if (e.key === "Enter" && highlight >= 0) {
            // 候補ハイライト中の Enter のみ確定に使う。未ハイライトの Enter は
            // フォーム submit を妨げないようスルー。
            e.preventDefault();
            pick(candidates[highlight].name);
          } else if (e.key === "Escape") {
            setIsOpen(false);
            setHighlight(-1);
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
      />
      {dropdown}
    </>
  );
}
