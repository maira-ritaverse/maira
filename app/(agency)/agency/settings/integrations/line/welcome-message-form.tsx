"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 自動 歓迎 メッセージ 設定 (admin 限定)。
 *
 * UI 仕様:
 *   ・ON / OFF + 本文 textarea
 *   ・Reply Token で 送信 する ので 課金 通数 0
 *   ・5,000 字 まで
 */
export function WelcomeMessageForm() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/agency/line/welcome", { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { enabled: boolean; text: string };
        if (active) {
          setEnabled(json.enabled);
          setText(json.text);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSavedAt(new Date());
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-5">
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">自動 歓迎 メッセージ</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          友達追加 された 時 に 自動 で 送信 する メッセージ。 Reply Token を 使う ので 課金通数 0
          です。
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        友達追加 時 に 自動 送信 する
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="line-welcome" className="text-xs">
          メッセージ 本文 (最大 5,000 字)
        </Label>
        <textarea
          id="line-welcome"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="例: はじめまして! ○○エージェント です。 ご登録 ありがとうございます。"
          className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm"
        />
        <p className="text-muted-foreground text-[10px]">{text.length} / 5,000 字</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {savedAt && !error && (
        <p className="text-xs text-emerald-700">
          保存しました ({savedAt.toLocaleTimeString("ja-JP")})
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </Card>
  );
}
