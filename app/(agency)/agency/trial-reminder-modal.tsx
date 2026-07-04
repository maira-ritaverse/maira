"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * トライアル 終了 リマインダー モーダル (Client)。
 *
 * ・親 レイアウト が daysRemaining <= 7 のとき だけ この コンポーネント を マウント する
 * ・localStorage の 「その 日 一度 でも 閉じたら 再表示 しない」 で dismissible
 * ・7 日 前 / 3 日 前 / 前 日 / 当日 は 文言 と 色 を 変えて 緊張 感 を 出す
 *
 * この モーダル は 「今 日 の 表示 を 閉じる」 だけ で、 契約 状況 は 変え ない。
 * ユーザー が Checkout / Portal に 進む 動線 だけ 提示 する。
 */
type Props = {
  daysRemaining: number;
  trialEndsAt: string;
  hasSubscription: boolean;
};

const DISMISS_KEY_PREFIX = "maira-trial-reminder-dismissed:";

/** ローカル タイム ゾーン で YYYY-MM-DD を 返す (dismiss キー 用)。 */
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function TrialReminderModal({ daysRemaining, trialEndsAt, hasSubscription }: Props) {
  // SSR は open=false で 出発 し、 hydration 後 に localStorage を 読 ん で 当日 未 閉じ なら 開く。
  // useState の lazy initializer は SSR 側 で window 参照 に なる の で 使え ず、
  // useEffect 内 setState で 開閉 を 反映 させる (hydration mismatch 回避)。
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = `${DISMISS_KEY_PREFIX}${todayKey()}`;
    const dismissed = window.localStorage.getItem(key);
    if (!dismissed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage の mount 後読み取りで open を反映
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    const key = `${DISMISS_KEY_PREFIX}${todayKey()}`;
    window.localStorage.setItem(key, "1");
    setOpen(false);
  };

  const urgency = daysRemaining <= 1 ? "critical" : daysRemaining <= 3 ? "high" : "normal";
  const title =
    urgency === "critical"
      ? daysRemaining <= 0
        ? "本日、無料期間が終了します"
        : "明日、無料期間が終了します"
      : `無料期間終了まで あと ${daysRemaining} 日`;

  const trialEndDate = new Date(trialEndsAt).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const iconClass =
    urgency === "critical"
      ? "text-red-600"
      : urgency === "high"
        ? "text-amber-600"
        : "text-emerald-600";

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Clock className={`h-5 w-5 ${iconClass}`} aria-hidden />
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>無料期間は{trialEndDate}で終了します。</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="text-sm">
          {hasSubscription ? (
            <p>
              カード情報はすでに登録済みなので、期間終了と同時に自動で有料プランへ移行します。
              停止したい場合は「契約管理へ進む」から解約予約を入れてください。
            </p>
          ) : (
            <p className="font-semibold text-amber-800">
              現在カード情報が未登録です。期間終了までにご契約手続きが完了しないと、
              期限後は読み取り専用モードとなり新規作成やAIの利用ができなくなります。
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss}>今日は閉じる</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              window.location.href = "/agency/settings/billing";
            }}
          >
            契約管理へ進む
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
