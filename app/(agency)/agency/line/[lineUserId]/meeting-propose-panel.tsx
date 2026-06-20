"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 面談 日程候補 提案 パネル
 *
 * UI:
 *   ・タイトル + 議題 + 所要時間
 *   ・候補 日時 を 3〜12 件 (datetime-local) で 入力
 *   ・送信 → /api/agency/line/share-meeting
 *
 * 求職者 は LINE Quick Reply で 1 つ 選ぶ → Zoom 招待 自動送信 (Chunk 18-19)。
 */
type Props = {
  lineUserId: string;
  onSent: () => Promise<void>;
  onClose: () => void;
  unfollowed: boolean;
};

export function MeetingProposePanel({ lineUserId, onSent, onClose, unfollowed }: Props) {
  const [title, setTitle] = useState("面談");
  const [agenda, setAgenda] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [slots, setSlots] = useState<string[]>([""]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSlot = () => {
    if (slots.length >= 12) return;
    setSlots([...slots, ""]);
  };
  const removeSlot = (i: number) => {
    setSlots(slots.filter((_, idx) => idx !== i));
  };
  const updateSlot = (i: number, value: string) => {
    setSlots(slots.map((s, idx) => (idx === i ? value : s)));
  };

  const onSend = async () => {
    if (unfollowed) {
      setError("ブロック / 友達解除 された 相手 には 送信 できません");
      return;
    }
    const filledSlots = slots.filter((s) => s.length > 0);
    if (filledSlots.length === 0) {
      setError("候補 日時 を 1 件以上 入力 して ください");
      return;
    }

    // datetime-local の "YYYY-MM-DDTHH:mm" を ISO 8601 (タイムゾーン付) に 変換
    const isoSlots: string[] = [];
    for (const s of filledSlots) {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        setError(`日時 形式 が 不正 です: ${s}`);
        return;
      }
      isoSlots.push(d.toISOString());
    }

    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/share-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId,
          title,
          agenda: agenda || undefined,
          durationMinutes,
          slots: isoSlots,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; candidateCount: number }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      await onSent();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3 border-t bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">面談 日程 を 提案</p>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="閉じる">
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="propose-title" className="text-xs">
            タイトル
          </Label>
          <Input
            id="propose-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 初回面談"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="propose-duration" className="text-xs">
            所要時間 (分)
          </Label>
          <Input
            id="propose-duration"
            type="number"
            min={5}
            max={480}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Math.max(5, Math.min(480, Number(e.target.value))))}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor="propose-agenda" className="text-xs">
            議題 (任意、 暗号化保存)
          </Label>
          <textarea
            id="propose-agenda"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="例: 希望条件のヒアリング"
            className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold">候補 日時 ({slots.length} / 12)</p>
        {slots.map((slot, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="datetime-local"
              value={slot}
              onChange={(e) => updateSlot(i, e.target.value)}
              className="flex-1"
            />
            {slots.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => removeSlot(i)} aria-label="削除">
                <X className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {slots.length < 12 && (
          <Button size="sm" variant="outline" onClick={addSlot}>
            <Plus className="mr-1 size-3.5" aria-hidden />
            候補 を 追加
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose} disabled={sending}>
          キャンセル
        </Button>
        <Button
          size="sm"
          onClick={onSend}
          disabled={sending || unfollowed}
          className="bg-[#06C755] text-white hover:bg-[#05a647]"
        >
          {sending ? "送信中..." : "LINE で 送信"}
        </Button>
      </div>
    </div>
  );
}
