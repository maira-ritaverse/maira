"use client";

import { useState, useTransition, type ReactElement, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * 共通 「アクション 確認 ダイアログ」
 *
 * 「削除 する」「解除 を 申請 する」「キャンセル する」 等、 ユーザー の 確定
 * 操作 を 1 段階 挟む 場面 で 全て この コンポーネント を 使う ように 統一 する
 * (UI の 表記 ゆれ / aria 属性 / pending / error 表示 の 重複 実装 を 排除)。
 *
 * 動作:
 *   ・trigger を 押す → モーダル が 開く
 *   ・確認 ボタン を 押す → onConfirm を 起動 (useTransition で 進行中 状態 管理)
 *   ・onConfirm が throw した 場合 → メッセージ を 赤字 表示 (モーダル は 開いたまま)
 *   ・onConfirm が 解決 した 場合 → モーダル を 閉じる (呼出 側 で router.refresh 等)
 *
 * 注意:
 *   ・router.refresh / push 等 の 後処理 は 呼出 側 onConfirm 内 で 行う
 *   ・destructive=true で 確認 ボタン を 赤系 に (削除 系 で 推奨)
 */
export type ConfirmActionDialogProps = {
  /** AlertDialogTrigger に 渡す 要素 (通常 は <Button> 要素 そのもの) */
  trigger: ReactElement;
  /** モーダル の タイトル */
  title: ReactNode;
  /** モーダル の 説明 文 (影響 範囲 を 書く) */
  description: ReactNode;
  /** 確認 ボタン の ラベル (例: 「削除 する」) */
  confirmLabel: string;
  /** 進行中 の 確認 ボタン ラベル (例: 「削除 中...」) */
  pendingLabel?: string;
  /** キャンセル ボタン の ラベル (デフォルト 「キャンセル」) */
  cancelLabel?: string;
  /** 確認 ボタン を 赤系 に する か (削除 / 取消 系) */
  destructive?: boolean;
  /** 確認 押下 時 の 処理。 throw すると error 表示。 解決 で 自動 close。 */
  onConfirm: () => Promise<void> | void;
};

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "キャンセル",
  destructive = false,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "操作 に 失敗 しました");
      }
    });
  };

  // open が false に 切り替わる タイミング で error を 消す (次回 開いた 時 に 残らない)
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setError(null);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={handleClick}
            disabled={isPending}
          >
            {isPending ? (pendingLabel ?? `${confirmLabel}…`) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
