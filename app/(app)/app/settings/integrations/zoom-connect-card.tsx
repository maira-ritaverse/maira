/**
 * Zoom 連携カード(設定画面)
 *
 * 表示パターン:
 *   ・未接続      → 「Zoom に接続」CTA + 解放される機能の説明
 *   ・接続済(全部) → 接続中アカウント + 有効機能の ✓ チェックリスト + 切断ボタン
 *   ・接続済(不足) → 「再認可で機能を解放」CTA + 不足機能のグレー表示
 *   ・サーバー未設定  → 「ご利用いただけません」disabled
 *   ・アドオン未契約  → 「アドオン契約が必要」disabled + アドオン契約導線
 *
 * サーバーコンポーネント。接続状態は親(page.tsx)から渡される。
 */
import Link from "next/link";
import { Check, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ZoomConnectionStatus } from "@/lib/integrations/connection-status";

import { DisconnectButton } from "./disconnect-button";

type Props = {
  status: ZoomConnectionStatus;
  zoomConfigured: boolean;
  hasMeetingAddon: boolean;
};

export function ZoomConnectCard({ status, zoomConfigured, hasMeetingAddon }: Props) {
  return (
    <Card className="space-y-4 p-5">
      {/* ヘッダ */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
            <Video className="size-5" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold">Zoom 連携</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Maira から Zoom 会議を予約し、Cloud Recording を自動取り込みします。
            </p>
            {status.connected && status.accountId && (
              <p className="text-muted-foreground mt-1 text-[11px]">
                接続中アカウント:<span className="font-mono">{status.accountId}</span>
              </p>
            )}
          </div>
        </div>
        {status.connected && !status.needsReauth && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] whitespace-nowrap text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            接続中
          </span>
        )}
        {status.connected && status.needsReauth && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] whitespace-nowrap text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            再認可が必要
          </span>
        )}
        {!zoomConfigured && (
          <span className="bg-muted rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap">
            ご利用いただけません
          </span>
        )}
      </div>

      {/* 機能ステータス
          - 会議作成/編集:接続だけで有効(無料機能)
          - 録画自動取込:アドオン契約必須(契約が無いと取込パイプラインがスキップされる)
       */}
      <ul className="space-y-2 text-sm">
        <FeatureRow
          enabled={status.meetingWriteEnabled}
          title="Maira からの会議作成・編集"
          body="クライアント詳細やカレンダーから 1 クリックで Zoom 会議を発行できます。待機室と自動録画が初期設定です。"
        />
        <FeatureRow
          enabled={status.connected && hasMeetingAddon}
          title={
            hasMeetingAddon
              ? "Cloud Recording の自動取り込み"
              : "Cloud Recording の自動取り込み(アドオン契約が必要)"
          }
          body="会議終了時に Webhook で通知を受け、録画ファイルを取り込みます。Whisper で文字起こしし、Claude が履歴書・職務経歴書のドラフトに反映します。"
        />
      </ul>

      {/* アクション */}
      <div className="flex flex-wrap gap-2 pt-1">
        {!zoomConfigured ? (
          <Button size="sm" disabled>
            Zoom に接続(ご利用いただけません)
          </Button>
        ) : !status.connected ? (
          <Button size="sm" render={<Link href="/api/integrations/zoom/connect" />}>
            Zoom に接続する
          </Button>
        ) : status.needsReauth ? (
          <>
            <Button size="sm" render={<Link href="/api/integrations/zoom/connect" />}>
              再認可して機能を解放する
            </Button>
            <DisconnectButton provider="zoom" />
          </>
        ) : (
          <DisconnectButton provider="zoom" />
        )}
      </div>
    </Card>
  );
}

function FeatureRow({ enabled, title, body }: { enabled: boolean; title: string; body: string }) {
  return (
    <li className={`flex items-start gap-3 ${enabled ? "" : "opacity-50"}`}>
      <span
        className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none font-bold ${
          enabled
            ? "bg-emerald-500 text-white"
            : "border-muted-foreground/40 text-muted-foreground border"
        }`}
        aria-hidden
      >
        {enabled ? <Check className="h-3 w-3" /> : "—"}
      </span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">{body}</div>
      </div>
    </li>
  );
}
