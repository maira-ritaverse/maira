"use client";

/**
 * 見送り・失注の理由入力モーダル。
 *
 * クライアント詳細フォームでステータスを「見送り(declined)」に変えた瞬間に開き、
 * クローズ理由(カテゴリ)+ 詳細理由(自由記述)を促す。失注を減らす分析のために
 * 「見送りにした時点で理由を残す」運用にするのが目的。
 *
 * 値は親フォーム(client-detail-form)の close_reason / close_reason_note に反映し、
 * 「見送りにして保存」で親の保存(PATCH)を実行する。
 */
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientCloseReasonLabels, type ClientCloseReason } from "@/lib/clients/types";
import { useDialog } from "@/lib/ui/use-dialog";

type ReasonValue = ClientCloseReason | "";

// 親は「開いている時だけマウント」する(初期値は mount 時のフォーム値で確定する)。
// これにより useEffect での同期 setState を避け、開くたびに最新値で初期化される。
type Props = {
  clientName: string;
  initialReason: ReasonValue;
  initialNote: string;
  /** 「見送りにして保存」= 値を親に反映して保存する */
  onConfirm: (reason: ReasonValue, note: string) => void;
  /** 「あとで入力」= 閉じるだけ(ステータスは見送りのまま) */
  onCancel: () => void;
};

// 見送り/失注のカテゴリ。成約(completed)はクローズ理由だが「見送り」文脈では出さない。
const LOSS_REASONS = (Object.keys(clientCloseReasonLabels) as ClientCloseReason[]).filter(
  (r) => r !== "completed",
);

export function DeclineReasonDialog({
  clientName,
  initialReason,
  initialNote,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // 見送り文脈の選択肢(LOSS_REASONS)に無い値(例: 既存が成約 completed)は
  // select に対応 option が無く空表示になるので、"" に正規化して開始する。
  const [reason, setReason] = useState<ReasonValue>(
    (LOSS_REASONS as readonly string[]).includes(initialReason) ? initialReason : "",
  );
  const [note, setNote] = useState(initialNote);

  useDialog(true, onCancel, dialogRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="decline-reason-title"
        className="w-full max-w-md"
      >
        <Card className="space-y-4 p-5">
          <div className="space-y-1">
            <h2 id="decline-reason-title" className="text-base font-semibold">
              見送り・失注の理由を残す
            </h2>
            <p className="text-muted-foreground text-xs">
              {clientName}{" "}
              さんを見送りにしました。失注を減らす分析に使うため、理由を残してください。
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="decline-reason-category" className="text-sm font-medium">
              理由(カテゴリ)
            </label>
            <select
              id="decline-reason-category"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReasonValue)}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">(未設定)</option>
              {LOSS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {clientCloseReasonLabels[r]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="decline-reason-note" className="text-sm font-medium">
              詳細理由(任意)
            </label>
            <textarea
              id="decline-reason-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="例: 提示年収が競合より 50 万低く B 社に流れた。次回は年収レンジを事前確認する。"
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
            <p className="text-muted-foreground text-xs">
              カテゴリだけでは分からない具体的な失注理由を残すと、傾向分析と改善に使えます。
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              あとで入力
            </Button>
            <Button type="button" size="sm" onClick={() => onConfirm(reason, note)}>
              見送りにして保存
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
