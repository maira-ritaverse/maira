"use client";

import { CalendarClock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { MeetingProposePanel } from "@/components/features/meetings/meeting-propose-panel";

/**
 * 顧客 詳細 から 「LINE で 日程候補 を 提案」 ダイアログ を 開く ボタン。
 *
 * 紐付け 済 LINE 友達 が ある 顧客 のみ 表示 (lineUserId が null なら 非表示)。
 * 既存 MeetingProposePanel を そのまま モーダル 内 で 流用。
 */
type Props = {
  lineUserId: string | null;
  unfollowed: boolean;
};

export function ProposeMeetingButton({ lineUserId, unfollowed }: Props) {
  const [open, setOpen] = useState(false);
  if (!lineUserId) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={unfollowed}
        title={
          unfollowed
            ? "友達 解除 / ブロック されて いる ため 送信 不可"
            : "LINE で 候補 日時 を 提案 → 求職者 が 選択 → 自動 で 会議 URL 発行"
        }
      >
        <CalendarClock className="mr-1 size-3.5" aria-hidden />
        LINE で 日程候補 を 提案
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-md bg-white shadow-xl">
            <MeetingProposePanel
              lineUserId={lineUserId}
              unfollowed={unfollowed}
              onClose={() => setOpen(false)}
              onSent={async () => {
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
