"use client";

import { AlertCircle, Check } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/api/client-fetch";
import { getSiteUrl } from "@/lib/config/site-url";
import type { LineChannel } from "@/lib/line/queries";

/**
 * 保存済 Channel の 現状表示 (上半分)
 * ・Channel ID / Bot 情報
 * ・Webhook URL コピー
 * ・接続検証 ボタン
 */
type Props = { channel: LineChannel };

export function LineChannelStatus({ channel }: Props) {
  const [verifyResult, setVerifyResult] = useState<
    null | { ok: true; displayName: string; basicId: string } | { ok: false; error: string }
  >(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  type SetupResult = {
    botInfo: { displayName: string; basicId: string } | null;
    webhook: {
      ok: boolean;
      url: string;
      registeredEndpoint: string | null;
      active: boolean;
      message?: string;
    };
    webhookTest: {
      ok: boolean;
      statusCode: number;
      reason: string;
      detail: string;
    } | null;
    liffId: string | null;
  };
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const onAutoSetup = async () => {
    setSetupRunning(true);
    setSetupError(null);
    setSetupResult(null);
    try {
      const res = await fetch("/api/agency/line/channel/setup", { method: "POST" });
      const body = (await res.json()) as
        | { ok: true; result: SetupResult }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message ? body.message : "error" in body ? body.error : "失敗";
        throw new Error(msg);
      }
      setSetupResult(body.result);
    } catch (e) {
      setSetupError(getErrorMessage(e));
    } finally {
      setSetupRunning(false);
    }
  };

  const webhookUrl = `${getSiteUrl()}/api/webhooks/line/${channel.webhookToken}`;

  const onVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/agency/line/channel/verify", { method: "POST" });
      const body = (await res.json()) as
        | { ok: true; botInfo: { displayName: string; basicId: string } }
        | { ok: false; error: string; message?: string };
      if ("ok" in body && body.ok) {
        setVerifyResult({
          ok: true,
          displayName: body.botInfo.displayName,
          basicId: body.botInfo.basicId,
        });
      } else {
        setVerifyResult({ ok: false, error: ("message" in body && body.message) || body.error });
      }
    } catch (e) {
      setVerifyResult({ ok: false, error: getErrorMessage(e) });
    } finally {
      setVerifying(false);
    }
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボード 拒否時 は 静かに 失敗 (ユーザーが 手動コピー 可能)
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">現在 の 連携</h2>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
          接続中
        </span>
      </div>

      <div className="grid gap-2 text-sm">
        <Row label="Channel ID">
          <span className="font-mono text-xs">{channel.lineChannelId}</span>
        </Row>
        {channel.lineBotUserId && (
          <Row label="Bot User ID">
            <span className="font-mono text-xs">{channel.lineBotUserId}</span>
          </Row>
        )}
        {channel.lastVerifiedAt && (
          <Row label="最終 検証">
            <span className="text-xs">
              {new Date(channel.lastVerifiedAt).toLocaleString("ja-JP")}
            </span>
          </Row>
        )}
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50/80 p-3 text-[11px]">
        <p className="font-semibold text-amber-900">
          求職者 側 に 「既読」 を 表示 する 設定 (任意)
        </p>
        <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-amber-900">
          <li>
            <a
              href="https://manager.line.biz/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              LINE Official Account Manager
            </a>{" "}
            → 設定 → 応答設定 → 「チャット」 を On
          </li>
          <li>
            <a
              href="https://developers.line.biz/console/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              LINE Developers コンソール
            </a>{" "}
            → 該当 Messaging API チャネル → 「Messaging API 設定」 →{" "}
            <strong>「LINE Official Account 機能」</strong> 内 の{" "}
            <strong>「メッセージ既読モード」</strong> を <strong>「手動 (manual)」</strong> に 変更
          </li>
          <li>Maira で トーク を 開く たび に 自動で 「既読」 が 求職者 側 に 反映 されます</li>
        </ol>
        <p className="mt-2 text-[10px] text-amber-800">
          ※ 初期 設定 (auto) の まま でも 求職者 が メッセージ を 送って すぐ 既読 になる ので
          大きな 差は ありません。 「Maira で 開いた タイミング = 既読」 と したい 場合 だけ 上記
          設定 して ください。
        </p>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-muted-foreground text-[11px] font-semibold">
          Webhook URL (LINE Developers に 貼り付け)
        </p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate font-mono text-[11px]">{webhookUrl}</code>
          <Button size="sm" variant="outline" onClick={onCopy}>
            {copied ? "コピー済" : "コピー"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onVerify} disabled={verifying}>
          {verifying ? "検証中..." : "接続 検証"}
        </Button>
        <Button size="sm" onClick={onAutoSetup} disabled={setupRunning}>
          {setupRunning ? "実行中..." : "自動セットアップ を 再実行"}
        </Button>
        {verifyResult && verifyResult.ok && (
          <span className="text-xs text-emerald-700">
            OK ({verifyResult.displayName} / {verifyResult.basicId})
          </span>
        )}
      </div>

      {verifyResult && !verifyResult.ok && (
        <Alert variant="destructive">
          <AlertDescription>検証 失敗:{verifyResult.error}</AlertDescription>
        </Alert>
      )}

      {setupError && (
        <Alert variant="destructive">
          <AlertDescription>{setupError}</AlertDescription>
        </Alert>
      )}

      {setupResult && (
        <Alert>
          <AlertDescription>
            <p className="font-semibold">自動セットアップ 結果</p>
            <ul className="mt-2 space-y-1 text-xs">
              <SetupItem
                ok={setupResult.webhook.ok}
                label={`Webhook URL を 設定: ${setupResult.webhook.url}`}
                detail={setupResult.webhook.message ?? null}
              />
              {setupResult.webhookTest && (
                <SetupItem
                  ok={setupResult.webhookTest.ok}
                  label={`Webhook 疎通テスト: HTTP ${setupResult.webhookTest.statusCode}`}
                  detail={setupResult.webhookTest.detail || setupResult.webhookTest.reason}
                />
              )}
              <SetupItem
                ok={setupResult.liffId !== null}
                label={
                  setupResult.liffId
                    ? `LIFF 設定済 (LIFF ID: ${setupResult.liffId})`
                    : "LIFF 未設定 (LINE Login チャネル で 作成 → 下記 LIFF セクション で 設定)"
                }
                detail={null}
              />
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}

function SetupItem({ ok, label, detail }: { ok: boolean; label: string; detail: string | null }) {
  return (
    <li className={`flex items-start gap-1 ${ok ? "text-emerald-700" : "text-amber-700"}`}>
      {ok ? (
        <Check className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>
        {label}
        {detail && ` — ${detail}`}
      </span>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
