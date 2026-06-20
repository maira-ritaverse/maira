"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * Rich Menu 設定 (admin 限定)。
 *
 * 仕様:
 *   ・LINE Developers / Manager で 事前 に 2 つ Rich Menu を 作成
 *   ・「default」= 未連携 友達 向け、 「linked」= 連携済 client_record 向け
 *   ・連携 完了 時 (連携コード 消費 / 手動紐付け) に 自動 で linked 側 へ 切替
 */
export function RichMenuForm() {
  const [defaultId, setDefaultId] = useState("");
  const [linkedId, setLinkedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/agency/line/rich-menu", { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          defaultRichMenuId: string | null;
          linkedRichMenuId: string | null;
        };
        if (active) {
          setDefaultId(json.defaultRichMenuId ?? "");
          setLinkedId(json.linkedRichMenuId ?? "");
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
      const res = await fetch("/api/agency/line/rich-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultRichMenuId: defaultId || null,
          linkedRichMenuId: linkedId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
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
        <h2 className="text-base font-semibold">Rich Menu (動的 切替)</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          連携 完了 時 (連携コード 消費 / 手動紐付け) に 個別 ユーザー の Rich Menu を 自動 で
          切替えます。 Rich Menu は LINE Developers コンソール か LINE Official Account Manager で
          事前 作成 して ください。
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rm-default" className="text-xs">
          デフォルト Rich Menu ID (未連携 友達 用、 例: 「連携 コード を 入力」)
        </Label>
        <Input
          id="rm-default"
          value={defaultId}
          onChange={(e) => setDefaultId(e.target.value)}
          placeholder="例: richmenu-abc123def456..."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rm-linked" className="text-xs">
          連携済 Rich Menu ID (client_record 紐付け 友達 用、 例: 「求人を見る」「面談予約」)
        </Label>
        <Input
          id="rm-linked"
          value={linkedId}
          onChange={(e) => setLinkedId(e.target.value)}
          placeholder="例: richmenu-xyz789..."
        />
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
