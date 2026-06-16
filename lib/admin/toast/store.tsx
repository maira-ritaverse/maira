"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * 運営管理画面用のトースト通知ストア。
 *
 * 設計:
 *   - React Context で useToast() を提供
 *   - メッセージは配列で複数同時表示可
 *   - 自動消去(デフォルト 5 秒)
 *   - manual dismiss も可(クリック / 閉じる ✕)
 *
 * 種別:
 *   - success(緑):削除成功 / 保存成功
 *   - error(赤):API 失敗 / バリデーション失敗
 *   - info(青):未読化など中性的な情報
 */

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

type ToastContextValue = {
  toasts: Toast[];
  showToast: (kind: ToastKind, message: string, durationMs?: number) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Provider:admin layout の最外周で使う。
 *
 * setTimeout を ref で持って、unmount 時に leak しないようにクリア。
 * SSR 上で動作する Server Component の中に include されても、初期 toasts=[] で
 * 表示するものが無いので問題なし。
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (kind: ToastKind, message: string, durationMs = 5000) => {
      // crypto.randomUUID は modern browser で利用可。
      // フォールバックはランダム文字列。
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `t-${Math.random().toString(36).slice(2)}-${performance.now()}`;
      setToasts((prev) => [...prev, { id, kind, message }]);
      const timer = setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismiss }}>{children}</ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() must be called inside <ToastProvider>");
  }
  return ctx;
}
