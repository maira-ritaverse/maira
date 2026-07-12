"use client";

/**
 * 新しい Flow を作成するモーダル。
 *
 * プリセット(7 種)から選ぶか、「空白 Flow」を選ぶ。作成後、ステップの追加は
 * 編集画面で行う。
 */
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LINE_FLOW_PRESETS } from "@/lib/ma/flow-presets";

type Choice = { key: string | null; label: string; description: string };

const CHOICES: Choice[] = [
  { key: null, label: "空白から作る", description: "起動条件やステップを一から組み立てる" },
  ...LINE_FLOW_PRESETS.map((p) => ({
    key: p.key,
    label: p.name,
    description: p.description,
  })),
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type Channel = "line" | "email";

export function NewFlowModal({ open, onOpenChange, onCreated }: Props) {
  const [channel, setChannel] = useState<Channel>("line");
  const [selected, setSelected] = useState<string | null>(CHOICES[0]?.key ?? null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // メールに切替時はプリセット選択を空白固定にする(プリセットは LINE 用のみ)
  const isEmail = channel === "email";
  const effectiveSelected = isEmail ? null : selected;
  const selectedChoice = CHOICES.find((c) => c.key === effectiveSelected) ?? CHOICES[0];
  const nameRequired = effectiveSelected === null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/ma/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset_key: effectiveSelected,
          channel,
          name: name.trim() || undefined,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "作成に失敗しました");
        return;
      }
      setChannel("line");
      setSelected(CHOICES[0]?.key ?? null);
      setName("");
      setDescription("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const submitDisabled = busy || (nameRequired && !name.trim());

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogTitle>新しい Flow を作成</AlertDialogTitle>
        <AlertDialogDescription>
          プリセットから選ぶか、空白から始めてください。ステップの追加は次の編集画面で行います。
        </AlertDialogDescription>

        <div className="my-4 space-y-3">
          {/* チャネル選択:公式 LINE / メール */}
          <div className="space-y-1">
            <Label>送信チャネル</Label>
            <div className="inline-flex overflow-hidden rounded border">
              <button
                type="button"
                onClick={() => setChannel("line")}
                className={`px-3 py-1.5 text-xs ${
                  channel === "line"
                    ? "bg-emerald-500 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                公式 LINE
              </button>
              <button
                type="button"
                onClick={() => setChannel("email")}
                className={`px-3 py-1.5 text-xs ${
                  channel === "email"
                    ? "bg-emerald-500 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                メール
              </button>
            </div>
            {isEmail && (
              <p className="text-muted-foreground text-xs">
                メール Flow は LINE 連携済み +
                メールアドレス登録済みの求職者にだけ届きます。プリセットは LINE
                用のみのため、空白から作成します。
              </p>
            )}
          </div>

          {!isEmail && (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {CHOICES.map((c) => {
                const id = `flow-preset-${c.key ?? "blank"}`;
                return (
                  <label
                    key={id}
                    htmlFor={id}
                    className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
                      selected === c.key ? "border-primary bg-muted/50" : "border-muted"
                    }`}
                  >
                    <input
                      id={id}
                      type="radio"
                      name="preset"
                      value={c.key ?? ""}
                      checked={selected === c.key}
                      onChange={() => setSelected(c.key)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{c.label}</div>
                      <div className="text-muted-foreground text-xs">{c.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="flow-name">
              名前 {nameRequired && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id="flow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                selectedChoice.key ? `未入力なら「${selectedChoice.label}」` : "この Flow の名前"
              }
              maxLength={200}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="flow-description">説明(任意)</Label>
            <Input
              id="flow-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          <Button disabled={submitDisabled} onClick={submit}>
            作成
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
