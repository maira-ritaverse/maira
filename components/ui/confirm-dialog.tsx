"use client";

/**
 * 汎用 確認 ダイアログ (window.confirm の 置き換え)。
 *
 * 使い方:
 *   const [open, setOpen] = useState(false);
 *   const [pending, setPending] = useState(false);
 *
 *   async function handleDelete() {
 *     setPending(true);
 *     try {
 *       await api.delete(...);
 *     } finally {
 *       setPending(false);
 *       setOpen(false);
 *     }
 *   }
 *
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="タスクを 削除しますか?"
 *     description="この 操作は 取り消せません。"
 *     confirmLabel="削除"
 *     destructive
 *     pending={pending}
 *     onConfirm={handleDelete}
 *   />
 *
 * 理由:
 *   従来 は 11+ 箇所 で window.confirm を 使用 して いた。 OS ネイティブ ダイアログ は
 *   (1) ブランド 外観 崩れ、 (2) 「今後 表示 しない」 で silent success 化 する 危険、
 *   (3) 日本語 の 半角 スペース 問題 が あり、 UX 上 不適切。
 */
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "実行",
  cancelLabel = "キャンセル",
  destructive = false,
  pending = false,
  onConfirm,
}: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // 開いた 瞬間 に 確認 ボタン に フォーカス。 Enter で 決定 できる ように。
  // (destructive の 場合 でも フォーカス は 確認 側 に する: 誤タップ 対策 は
  //  ラベル 「削除」 と 赤 色 で 十分。 UX 優先。)
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => confirmBtnRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Esc キー で 閉じる (pending 中 は 閉じない)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // 背景 タップ で 閉じる (pending 中 は 閉じない)
        if (e.target === e.currentTarget && !pending) onOpenChange(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <Card className="bg-background w-full max-w-md space-y-4 p-6 shadow-xl">
        <div className="flex items-start gap-3">
          {destructive && (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" aria-hidden />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id="confirm-dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            {description && (
              <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmBtnRef}
            type="button"
            size="sm"
            onClick={() => void onConfirm()}
            disabled={pending}
            className={
              destructive
                ? "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
                : undefined
            }
          >
            {pending ? "処理中..." : confirmLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
