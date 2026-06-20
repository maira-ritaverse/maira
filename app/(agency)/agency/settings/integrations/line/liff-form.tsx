"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";
import { getSiteUrl } from "@/lib/config/site-url";

/**
 * LIFF アプリ 設定 フォーム (admin 限定)。
 *
 * フロー:
 *   1. LINE Developers コンソール で LIFF アプリ を 作成
 *   2. Endpoint URL に Maira が 表示 する URL を 設定
 *   3. LIFF ID を コピー → この フォーム に 入力
 *
 * 設定 後 は 求人共有 Flex Message の リンク が LIFF URL に なり、
 * 求職者 が LINE 内 ブラウザ で 求人詳細 を 開ける ように なる。
 */
type Props = { organizationId: string };

export function LiffForm({ organizationId }: Props) {
  const [liffId, setLiffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);

  const endpointUrl = `${getSiteUrl()}/liff/${organizationId}`;

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/agency/line/channel", { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          channel: { liffId: string | null } | null;
        };
        if (active && json.channel) {
          setLiffId(json.channel.liffId ?? "");
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
      const res = await fetch("/api/agency/line/liff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liffId: liffId || null }),
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

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(endpointUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 静かに 失敗
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
        <h2 className="text-base font-semibold">LIFF (LINE 内 ブラウザ)</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {liffId
            ? "Channel 接続時 に Maira が 自動 作成 済み。 手動上書き が 必要な 場合 のみ 触って ください。"
            : "Channel 接続時 に 自動作成 されます。 既存 の LIFF アプリ を 流用 する 場合 は LIFF ID を 入力 して ください。"}
        </p>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-muted-foreground text-[11px] font-semibold">Endpoint URL</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate font-mono text-[11px]">{endpointUrl}</code>
          <Button size="sm" variant="outline" onClick={onCopy}>
            {copied ? "コピー済" : "コピー"}
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="liff-id" className="text-xs">
          LIFF ID
        </Label>
        <Input
          id="liff-id"
          value={liffId}
          onChange={(e) => setLiffId(e.target.value)}
          placeholder="例: 1234567890-AbCdEfGh"
        />
        <p className="text-muted-foreground text-[10px]">
          空欄 で 保存 する と LIFF 無効。 既存 の 求人共有 リンク は 通常 URL に 戻ります。
        </p>
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
