"use client";

/**
 * 新規 Flow 作成 モーダル。
 *
 * プリセット (7 種) から 選ぶ か、 「空白 Flow」 を 選ぶ。 選択 後 に
 * POST /api/agency/ma/flows を 叩き、 成功 した ら onCreated で 一覧 を 更新。
 *
 * Phase 1-E で は 作成 のみ。 ステップ 設定 は 次 の 編集 画面 (Phase 1-F) で 行う。
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
  { key: null, label: "空白 Flow", description: "trigger や ステップ を 一から 組む" },
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

export function NewFlowModal({ open, onOpenChange, onCreated }: Props) {
  const [selected, setSelected] = useState<string | null>(CHOICES[0]?.key ?? null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedChoice = CHOICES.find((c) => c.key === selected) ?? CHOICES[0];
  const nameRequired = selected === null; // 空白 Flow は name 必須

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/ma/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset_key: selected,
          name: name.trim() || undefined,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "作成 に 失敗 しました");
        return;
      }
      // reset
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
        <AlertDialogTitle>新規 Flow を 作成</AlertDialogTitle>
        <AlertDialogDescription>
          プリセット を 選ぶ か、 空白 で 開始 して ください。 ステップ の 追加 は 次 の 編集 画面
          で 行い ます。
        </AlertDialogDescription>

        <div className="my-4 space-y-3">
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

          <div className="space-y-1">
            <Label htmlFor="flow-name">
              名前 {nameRequired && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id="flow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                selectedChoice.key
                  ? `未指定 なら 「${selectedChoice.label}」`
                  : "空白 Flow の 表示 名"
              }
              maxLength={200}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="flow-description">説明 (任意)</Label>
            <Input
              id="flow-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>

          {error && <p className="text-destructive text-sm">エラー: {error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button disabled={submitDisabled} onClick={submit}>
            作成
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
