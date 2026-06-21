"use client";

import { AlertTriangle, Check } from "lucide-react";
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

/**
 * テスト送信モーダル
 *
 * 1 シナリオを選んで、指定したメアド宛にテスト送信する。
 * Resend API キー未設定なら no-op で status='skipped' になるが、UI 上は同じ流れで完了する。
 *
 * 結果トースト相当の表示はモーダル内に簡易表示(成功・失敗・スキップ)。
 * Phase D で本格的なトースト基盤を入れたらそちらに移行。
 */
export type TestSendModalProps = {
  open: boolean;
  scenarioId: string;
  scenarioName: string;
  onClose: () => void;
};

type SendResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed" | "template_missing"; error?: string };

export function TestSendModal({ open, scenarioId, scenarioName, onClose }: TestSendModalProps) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/agency/ma/scenarios/${encodeURIComponent(scenarioId)}/test-send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientEmail }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        result?: SendResult;
        message?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.message ?? `送信に失敗しました(${res.status})`);
      }
      if (data?.result) setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    if (sending) return;
    // 次回開いたときに前回の結果が残らないようリセット
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogTitle>テスト送信</AlertDialogTitle>
        <AlertDialogDescription className="text-sm">
          シナリオ「{scenarioName}」のテンプレートを 1 通だけ送信します。
          <br />
          変数は仮の値(候補者名「山田 太郎」等)で展開されます。
        </AlertDialogDescription>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="recipientEmail">送信先メールアドレス</Label>
            <Input
              id="recipientEmail"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              disabled={sending}
              placeholder="example@example.com"
            />
            <p className="text-muted-foreground text-xs">
              ログイン中のメールアドレスを初期表示しています。変更可能。
            </p>
          </div>

          {/* 結果表示 */}
          {result?.sent && (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">
              <span className="inline-flex items-center gap-1">
                <Check className="size-3.5" aria-hidden />
                送信成功
              </span>
              {result.messageId && (
                <span className="text-muted-foreground ml-2 font-mono text-xs">
                  ID: {result.messageId.slice(0, 12)}…
                </span>
              )}
            </div>
          )}
          {result && !result.sent && result.reason === "not_configured" && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="size-3.5" aria-hidden />
                Resend が未設定(skipped としてログ記録)
              </span>
              <br />
              <span className="text-xs">
                RESEND_API_KEY / EMAIL_FROM を設定すると実送信されます。
              </span>
            </div>
          )}
          {result && !result.sent && result.reason === "template_missing" && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
              テンプレート未保存です。先にテンプレート編集で件名・本文を保存してください。
            </div>
          )}
          {result && !result.sent && result.reason === "send_failed" && (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              送信に失敗しました
              <br />
              <span className="font-mono text-xs break-all">{result.error}</span>
            </div>
          )}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={sending}>
            閉じる
          </Button>
          <Button onClick={handleSend} disabled={sending || recipientEmail.trim().length === 0}>
            {sending ? "送信中..." : "送信"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
