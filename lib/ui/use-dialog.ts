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
 */
import { useEffect, type RefObject } from "react";

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
  useEffect(() => {
    if (!open) return;

    // 1) 直前のフォーカスを覚えておく
    const previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;

    // 2) Esc + Tab トラップ
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
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
  }, [open, onClose, dialogRef]);
}
