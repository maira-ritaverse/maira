/**
 * Google アカウント連携カード(設定画面)
 *
 * 1 クリックで calendar.events スコープを取得し、Maira からの 面談予約
 * (Meet URL 付き)が Google カレンダーに 自動登録 される。
 *
 * 2026-06-19 変更:drive.readonly スコープ を 撤去。
 *   Google の Restricted scope(CASA 監査 必須)を 回避するため、Meet 録画は
 *   ユーザーが Maira に 手動 アップロード する 運用に 切替え。
 *
 * 表示パターン:
 *   ・未接続      → 大きな「Google アカウントを連携」CTA + 解放される機能の説明
 *   ・接続済      → 接続中アカウント + 有効機能の ✓ チェックリスト + 切断ボタン
 *   ・接続済(不足) → 「再認可で機能を解放」CTA + 不足機能のグレー表示
 *   ・サーバー未設定  → 「ご利用いただけません」disabled
 *
 * サーバーコンポーネント。接続状態は親(page.tsx)から渡される。
 */
import { Calendar, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { GoogleConnectionStatus } from "@/lib/integrations/connection-status";

import { DisconnectButton } from "./disconnect-button";
import { GoogleLinkButton } from "./google-link-button";

type Props = {
  status: GoogleConnectionStatus;
  googleConfigured: boolean;
};

export function GoogleConnectCard({ status, googleConfigured }: Props) {
  return (
    <Card className="space-y-4 p-5">
      {/* ヘッダ */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
            <Calendar className="size-5" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold">Google アカウント連携</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Maira から Google カレンダーに 面談予定(Meet URL 付き)を 直接 登録できます。
            </p>
            {status.connected && status.email && (
              <p className="text-muted-foreground mt-1 text-[11px]">
                接続中:<span className="font-mono">{status.email}</span>
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
        {!googleConfigured && (
          <span className="bg-muted rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap">
            ご利用いただけません
          </span>
        )}
      </div>

      {/* 機能ステータス(ベネフィットを視覚化) */}
      <ul className="space-y-2 text-sm">
        <FeatureRow
          enabled={status.calendarEnabled}
          title="Google カレンダー連携"
          body="Maira の予定と Google カレンダーを統合し、編集・新規作成ができます。Maira から 面談予約すると Google カレンダー(+ Meet URL)に 自動登録 されます。"
        />
        <FeatureRow
          enabled={false}
          title="Google Meet 録画の自動取込(廃止)"
          body="2026-06-19 撤去。Google Drive 内の Meet 録画ファイルを Maira に取り込む 場合は、ユーザーが クライアント詳細 画面から 手動アップロード してください。Zoom Cloud Recording の 自動取り込みは 引き続き ご利用いただけます。"
        />
      </ul>

      {/* アクション */}
      <div className="flex flex-wrap gap-2 pt-1">
        {!googleConfigured ? (
          <Button size="sm" disabled>
            Google に接続(ご利用いただけません)
          </Button>
        ) : !status.connected ? (
          <GoogleLinkButton label="Google アカウントを連携する" />
        ) : status.needsReauth ? (
          <>
            <GoogleLinkButton label="再認可して機能を解放する" />
            <DisconnectButton provider="google" />
          </>
        ) : (
          <DisconnectButton provider="google" />
        )}
      </div>

      {status.connected && !status.needsReauth && (
        <p className="text-muted-foreground text-[11px]">
          次回からは、ログイン画面で「Google でログイン」を選んでもこのアカウントで入れます。
        </p>
      )}
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
