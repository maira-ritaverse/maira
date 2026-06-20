import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { checkIntakeLimit } from "@/lib/features/usage-limits";
import { getActiveAddons } from "@/lib/features/entitlements";
import {
  getGoogleConnectionStatus,
  getZoomConnectionStatus,
} from "@/lib/integrations/connection-status";
import { getGoogleConfig } from "@/lib/integrations/google";
import { getStripeConfig } from "@/lib/integrations/stripe";
import { getZoomConfig } from "@/lib/integrations/zoom";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import {
  OpenPortalButton,
  StartCheckoutButton,
} from "@/app/(app)/app/settings/integrations/billing-buttons";
import { CalendarFeedSection } from "@/app/(app)/app/settings/integrations/calendar-feed-section";
import { GoogleConnectCard } from "@/app/(app)/app/settings/integrations/google-connect-card";
import { ZoomConnectCard } from "@/app/(app)/app/settings/integrations/zoom-connect-card";

/**
 * エージェント業務用の外部サービス連携ページ
 *
 * /app/settings/integrations(求職者向け)から移動:
 *   ・Zoom / Google Meet 連携(エージェント本人の業務アカウント)
 *   ・「会議録音 自動連携」アドオン契約
 *   ・カレンダー購読 URL(エージェント本人の予定を外部カレンダーで購読)
 *
 * 求職者は「面談に参加するだけ」で十分なため、この機能群は agency に集約する。
 */
export default async function AgencyIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; addon?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const sp = await searchParams;

  const [addons, intakeLimit, zoomStatus, googleStatus] = await Promise.all([
    getActiveAddons(supabase, user.id),
    checkIntakeLimit(supabase, user.id),
    getZoomConnectionStatus(supabase, user.id),
    getGoogleConnectionStatus(supabase, user.id),
  ]);
  const hasMeetingAddon = addons.includes("meeting_recording_auto");
  const zoomConfigured = getZoomConfig() !== null;
  const googleConfigured = getGoogleConfig() !== null;
  const stripeConfigured = getStripeConfig() !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/agency/settings" className="hover:underline">
            ← 個人設定
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">連携・アドオン</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Zoom / Google Meet を業務アカウントに連携して、面談予約や録画取り込みを自動化します。
        </p>
      </div>

      {/* バナー(コールバックからの戻り) */}
      {sp.connected && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {sp.connected === "zoom" ? "Zoom" : "Google"} に接続しました。
        </div>
      )}
      {sp.addon === "success" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          アドオンの購入手続きが完了しました。反映には数分かかる場合があります。
        </div>
      )}
      {sp.addon === "canceled" && (
        <div className="bg-muted rounded-md border p-3 text-xs">
          アドオン購入はキャンセルされました。
        </div>
      )}
      {sp.error && (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          連携でエラーが発生しました:{sp.error}
        </div>
      )}

      {/* アドオン(会議録音 自動連携) */}
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">アドオン:会議録音 自動連携</h2>
          {hasMeetingAddon ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              契約中
            </span>
          ) : (
            <span className="bg-muted rounded-full px-2 py-0.5 text-[11px]">未契約</span>
          )}
        </div>
        <ul className="text-muted-foreground ml-4 list-disc text-sm">
          <li>Zoom Cloud Recording の自動取り込み</li>
          <li>Google Meet 録画(Google Drive)の自動取り込み</li>
          <li>月次の AI ヒアリング上限が拡張されます({intakeLimit.limit} 回 / 月)</li>
        </ul>
        {!hasMeetingAddon ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {stripeConfigured ? (
              <StartCheckoutButton />
            ) : (
              <Button size="sm" disabled>
                アドオンを追加する(近日)
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {stripeConfigured && <OpenPortalButton />}
          </div>
        )}
      </Card>

      {/* Zoom 連携 */}
      <ZoomConnectCard
        status={zoomStatus}
        zoomConfigured={zoomConfigured}
        hasMeetingAddon={hasMeetingAddon}
      />

      {/* Google 連携(Calendar + Drive 録画取込) */}
      <GoogleConnectCard status={googleStatus} googleConfigured={googleConfigured} />

      {/* LINE 公式アカウント 連携 (Phase 1 〜) */}
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">LINE 公式アカウント 連携</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          御社 の 公式LINE と Maira を 連携 し、 求職者 と の やり取り を Maira UI で 完結 +
          求人共有 / Zoom 案内 を LINE 経由 で 可能 に します。
        </p>
        <div className="pt-1">
          <Link
            href="/agency/settings/integrations/line"
            className="hover:text-foreground inline-flex items-center text-sm font-medium underline"
          >
            設定 / 接続状況 を 確認 →
          </Link>
        </div>
      </Card>

      {/* カレンダー購読 URL(エージェントの予定を Google Calendar 等で購読) */}
      <CalendarFeedSection />
    </div>
  );
}
