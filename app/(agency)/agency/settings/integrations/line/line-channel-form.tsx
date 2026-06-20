"use client";

import { AlertCircle, Check } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";
import type { LineChannel } from "@/lib/line/queries";

/**
 * LINE Channel 設定 フォーム (admin 限定)。
 *
 * 入力:Channel ID / Channel Secret / Channel Access Token (長期)
 * 送信時 に サーバ側 で LINE API 検証 → 成功時 のみ DB 保存。
 * 既存 Token は 復号して 再表示せず (セキュリティ)、 「再設定する」場合 は 全部 再入力。
 */
type Props = { initialChannel: LineChannel | null };

export function LineChannelForm({ initialChannel }: Props) {
  const [lineChannelId, setLineChannelId] = useState(initialChannel?.lineChannelId ?? "");
  const [channelSecret, setChannelSecret] = useState("");
  const [channelAccessToken, setChannelAccessToken] = useState("");
  const [linePlan, setLinePlan] = useState<"free" | "light" | "standard" | "">(
    initialChannel?.linePlan ?? "",
  );

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        ok: true;
        botName: string;
        autoSetup: {
          webhookSet: boolean;
          webhookError?: string;
        };
      }
    | { ok: false; error: string }
  >(null);

  const reconfiguring = initialChannel !== null;
  const [openForm, setOpenForm] = useState(!reconfiguring);

  const submit = async () => {
    if (!lineChannelId || !channelSecret || !channelAccessToken) {
      setResult({
        ok: false,
        error: "Channel ID / Secret / Access Token を 全て 入力 して ください",
      });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/agency/line/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineChannelId,
          channelSecret,
          channelAccessToken,
          linePlan: linePlan || null,
        }),
      });
      const body = (await res.json()) as
        | {
            ok: true;
            botInfo: { displayName: string };
            autoSetup: {
              webhookSet: boolean;
              webhookError?: string;
            };
          }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : "保存 失敗";
        setResult({ ok: false, error: msg });
        return;
      }
      setResult({ ok: true, botName: body.botInfo.displayName, autoSetup: body.autoSetup });
      // 機密入力 は フォームから 即時 クリア
      setChannelSecret("");
      setChannelAccessToken("");
      setOpenForm(false);
      // 自動セットアップ 結果 を 数秒 見せて から リロード
      setTimeout(() => window.location.reload(), 4000);
    } catch (e) {
      setResult({ ok: false, error: getErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  if (reconfiguring && !openForm) {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">設定 を 再構成</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Token を ローテーション した / 別 Channel に 切り替える 場合 に 使用 します。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpenForm(true)}>
            再設定 する
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">
          {reconfiguring ? "Channel 設定 を 再構成" : "Channel を 接続"}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          機密情報 (Secret / Access Token) は サーバ側 で AES-256-GCM 暗号化 して 保存 します。
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="line-channel-id" className="text-xs">
            Channel ID
          </Label>
          <Input
            id="line-channel-id"
            value={lineChannelId}
            onChange={(e) => setLineChannelId(e.target.value)}
            placeholder="例: 1234567890"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="line-channel-secret" className="text-xs">
            Channel Secret <span className="text-muted-foreground">(機密)</span>
          </Label>
          <Input
            id="line-channel-secret"
            type="password"
            value={channelSecret}
            onChange={(e) => setChannelSecret(e.target.value)}
            placeholder="32 桁の 16 進数"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="line-access-token" className="text-xs">
            Channel Access Token (長期) <span className="text-muted-foreground">(機密)</span>
          </Label>
          <Input
            id="line-access-token"
            type="password"
            value={channelAccessToken}
            onChange={(e) => setChannelAccessToken(e.target.value)}
            placeholder="long-lived access token"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-[10px]">
            LINE コンソール「Messaging API設定」→「チャネルアクセストークン (長期)」で 発行。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="line-plan" className="text-xs">
            LINE 公式アカウント プラン{" "}
            <span className="text-muted-foreground">(任意、 参考表示用)</span>
          </Label>
          <select
            id="line-plan"
            value={linePlan}
            onChange={(e) => setLinePlan(e.target.value as "free" | "light" | "standard" | "")}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">(指定 しない)</option>
            <option value="free">Free (月 200 通)</option>
            <option value="light">ライト (月 5,000 通 / ¥5,000)</option>
            <option value="standard">スタンダード (月 30,000 通 / ¥15,000)</option>
          </select>
        </div>
      </div>

      {result && result.ok && (
        <Alert>
          <AlertDescription>
            <p className="font-semibold text-emerald-700">接続 OK ({result.botName})</p>
            <ul className="mt-2 space-y-1 text-xs">
              <li
                className={`flex items-start gap-1 ${result.autoSetup.webhookSet ? "text-emerald-700" : "text-amber-700"}`}
              >
                {result.autoSetup.webhookSet ? (
                  <Check className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                )}
                <span>
                  Webhook URL を LINE 側 に 自動設定
                  {result.autoSetup.webhookError && ` (${result.autoSetup.webhookError})`}
                </span>
              </li>
              <li className="flex items-start gap-1 text-slate-600">
                <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                <span>
                  LIFF を 使う 場合 は LINE Login チャネル を 別途 作成 → 下記 LIFF フォーム に LIFF
                  ID を 貼り付け
                </span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-600">4 秒後 に ページを 再読み込み します。</p>
          </AlertDescription>
        </Alert>
      )}
      {result && !result.ok && (
        <Alert variant="destructive">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        {reconfiguring && (
          <Button size="sm" variant="outline" onClick={() => setOpenForm(false)}>
            キャンセル
          </Button>
        )}
        <Button onClick={submit} disabled={saving}>
          {saving ? "検証 + 保存 中..." : reconfiguring ? "再設定 する" : "接続 する"}
        </Button>
      </div>
    </Card>
  );
}
