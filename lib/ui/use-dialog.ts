"use client";

/**
 * モーダルダイアログ共通フック(a11y 対応)
 *
 * 機能:
 *   - Esc キーで onClose を呼ぶ
 *   - 開いている間、body のスクロールをロック
 *   - 開いた時に直前のフォーカスを記憶し、閉じた時に復帰する
 *   - dialogRef が渡されていれば、開いた直後に内部の最初のフォーカス可能要素にフォーカス
 *   - Tab / Shift+Tab で内部にフォーカスをトラップする(外に出ない)
 *
 * 使い方:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useDialog(open, onClose, ref);
 *   <div ref={ref} role="dialog" aria-modal="true" ...>
 *
 * 重要な実装メモ:
 *   onClose を effect の依存に含めると、呼び出し側コンポーネントが
 *   毎 render で新しい関数参照を渡してくるたびに effect が再実行され、
 *   queueMicrotask の「最初の要素にフォーカス」が走って入力中の input から
 *   フォーカスが奪われる(入力できたり できなかったりする挙動の原因)。
 *   ref に逃がして、効果は open / dialogRef の変化時のみ走らせる。
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const list = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(list).filter((el) => !el.hasAttribute("data-skip-focus"));
}

export function useDialog(
  open: boolean,
  onClose: () => void,
  dialogRef?: RefObject<HTMLElement | null>,
): void {
  // onClose を ref に逃がす。毎 render で参照が変わっても effect は再実行しない。
  // 更新は別 effect でやる(render 中の ref 書き換えは react-hooks/refs に弾かれるため)。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    // 1) 直前のフォーカスを覚えておく
    const previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;

    // 2) Esc + Tab トラップ
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && dialogRef?.current) {
        const focusables = getFocusableElements(dialogRef.current);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement;
        const insideDialog = dialogRef.current.contains(active);
        if (e.shiftKey) {
          if (active === first || !insideDialog) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !insideDialog) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKey);

    // 3) body スクロールロック
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 4) 開いた直後に内部の最初の要素にフォーカス
    // 描画が終わる前だとフォーカスが効かないので microtask に逃がす
    queueMicrotask(() => {
      if (!dialogRef?.current) return;
      const focusables = getFocusableElements(dialogRef.current);
      if (focusables.length > 0) focusables[0].focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
      // 元のフォーカスへ復帰(ボタン押下で閉じた場合のキーボード操作のために重要)
      previouslyFocused?.focus?.();
    };
    // 依存は open / dialogRef のみ。onClose は ref 経由で読むので含めない。
  }, [open, dialogRef]);
}
