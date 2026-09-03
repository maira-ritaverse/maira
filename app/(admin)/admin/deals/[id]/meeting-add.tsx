"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { preflightAudioFile } from "@/lib/career-intake/preflight";
import { SALES_STAGE_KEYS, SALES_STAGE_LABEL, type SalesMeeting } from "@/lib/sales/types";

type Mode = "upload" | "text";

export function MeetingAdd({
  prospectId,
  onAdded,
}: {
  prospectId: string;
  onAdded: (m: SalesMeeting) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("upload");
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [stage, setStage] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflightMsg, setPreflightMsg] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setMeetingDate("");
    setStage("");
    setFile(null);
    setText("");
    setError(null);
    setPreflightMsg(null);
  };

  const onFile = async (f: File | null) => {
    setFile(f);
    setPreflightMsg(null);
    setError(null);
    if (!f) return;
    const pf = await preflightAudioFile(f);
    if (!pf.ok) {
      const blocking = pf.issues.find((i) => i.level === "blocking");
      setError(blocking?.message ?? "このファイルは取り込めません");
      setFile(null);
      return;
    }
    const warn = pf.issues.find((i) => i.level === "warning");
    if (warn) setPreflightMsg(warn.message);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "upload") {
        if (!file) {
          setError("録音ファイルを選択してください");
          setBusy(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("filename", file.name);
        if (title.trim()) fd.append("title", title.trim());
        if (meetingDate) fd.append("meeting_date", meetingDate);
        if (stage) fd.append("stage", stage);
        res = await fetch(`/api/admin/deals/${prospectId}/meetings`, { method: "POST", body: fd });
      } else {
        if (!text.trim()) {
          setError("テキストを入力してください");
          setBusy(false);
          return;
        }
        res = await fetch(`/api/admin/deals/${prospectId}/meetings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            title: title.trim() || null,
            meeting_date: meetingDate || null,
            stage: stage || null,
          }),
        });
      }
      const json = (await res.json().catch(() => ({}))) as {
        meeting?: SalesMeeting;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.meeting) {
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      }
      onAdded(json.meeting);
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り込みに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + ミーティングを追加
      </Button>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <ModeButton active={mode === "upload"} onClick={() => setMode("upload")}>
          録音をアップロード
        </ModeButton>
        <ModeButton active={mode === "text"} onClick={() => setMode("text")}>
          テキストを貼り付け
        </ModeButton>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">タイトル(任意)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="例:営業2回目"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">日付(任意)</Label>
          <Input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">ステージ(任意)</Label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="">未設定</option>
            {SALES_STAGE_KEYS.map((k) => (
              <option key={k} value={k}>
                {SALES_STAGE_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mode === "upload" ? (
        <div className="space-y-1">
          <input
            type="file"
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <p className="text-muted-foreground text-xs">
            25MB まで。文字起こし → 議事録の生成に 30〜120 秒ほどかかります。
          </p>
          {preflightMsg && <p className="text-xs text-amber-700">{preflightMsg}</p>}
        </div>
      ) : (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={60000}
          placeholder="議事メモ・文字起こしテキストを貼り付け"
        />
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy ? "処理中…(そのままお待ちください)" : "取り込む"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={busy}
        >
          キャンセル
        </Button>
      </div>
    </Card>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-xs font-medium ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
