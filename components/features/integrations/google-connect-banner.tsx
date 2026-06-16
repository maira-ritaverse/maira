/**
 * Google 連携促進バナー(エージェント向けダッシュボード上部 / カレンダー画面 等)
 *
 * 表示条件:
 *   - Google 未接続 もしくは 必要スコープ不足
 * クリック → 直接 /api/integrations/google/connect(同意画面に飛ぶ)
 *
 * 1 回出して「閉じる」した人にはセッション内では出さない(localStorage)。
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { Calendar, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type Props = {
  connected: boolean;
  needsReauth: boolean;
};

const DISMISS_KEY = "maira:google-banner-dismissed-at";
const DISMISS_TTL_DAYS = 7;

/**
 * localStorage を初期値として読み込む。SSR では window が無いので false を返す。
 * useState 初期化関数として渡すため lazy 評価される(初回 render 時 1 回のみ)。
 */
function readDismissedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at <= DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function GoogleConnectBanner({ connected, needsReauth }: Props) {
  // 初回 mount 時に localStorage を読む(lazy initializer)
  // ハイドレーション差分は許容(client-only な dismissal なので影響軽微)
  const [dismissed, setDismissed] = useState<boolean>(readDismissedFromStorage);

  // 接続済 + スコープ十分 → 出さない
  if (connected && !needsReauth) return null;
  if (dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // localStorage 不可は黙って続行
    }
    setDismissed(true);
  };

  const message = needsReauth
    ? "Google の再認可で「カレンダー連携」と「Meet 録画の自動取り込み」が解放されます。"
    : "Google アカウントを連携すると、カレンダー連携と Meet 録画の自動取り込みが 1 回で有効になります。";

  return (
    <div className="border-primary/30 bg-primary/5 flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="bg-background text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
          <Calendar className="size-3.5" aria-hidden />
        </div>
        <div className="text-sm">
          <div className="font-medium">
            {needsReauth ? "Google を再接続して機能を解放" : "Google アカウントを連携"}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">{message}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" render={<Link href="/api/integrations/google/connect" />}>
          {needsReauth ? "再認可する" : "連携する"}
        </Button>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded"
          aria-label="閉じる"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
