"use client";

import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 連携 コード 発行 ボタン (Client)。
 *
 * ・POST /api/agency/line/link-codes { clientRecordId }
 * ・成功: 6 桁 コード を 24 時間 有効 で 表示、 コピー ボタン付き
 * ・失敗: 赤字 エラー
 */
type Props = {
  clientRecordId: string;
};

export function LineLinkCodeButton({ clientRecordId }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = async () => {
    // L3: 秒 単位 で 連打 して 新規 コード を 大量 発行 する と、 顧客 が 最初 に
    // コピー した コード が 別 発行 で 失効 する 混乱 が 生じる。 UI 側 で 連打 を
    // 防ぐ。 サーバ 側 の 「60 秒 以内 の 既存 コード は 再利用」 は 後日 RPC で 対応。
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/agency/line/link-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRecordId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { code: string };
      setCode(json.code);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      // 1 秒 クール ダウン
      setTimeout(() => setBusy(false), 1000);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard 失敗 は 無視 (ブラウザ 許可 待ち)
    }
  };

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={issue} disabled={busy} variant="outline">
        <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {busy ? "発行 中…" : "連携 コード を 発行"}
      </Button>
      {code && (
        <div className="flex items-center gap-2">
          <code className="rounded bg-amber-100 px-2 py-1 font-mono text-sm font-bold tracking-widest text-amber-900">
            {code}
          </code>
          <button
            type="button"
            onClick={copy}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <Copy className="h-3 w-3" aria-hidden />
            {copied ? "コピー 済" : "コピー"}
          </button>
          <span className="text-muted-foreground text-[10px]">
            24 時間 有効。 顧客 が LINE で 送ると 自動 紐付け。
          </span>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
