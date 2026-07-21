import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getSiteUrl } from "@/lib/config/site-url";
import {
  getBotInfo,
  getWebhookEndpoint,
  setWebhookEndpoint,
  testWebhookEndpoint,
} from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/channel/setup
 *
 * 接続済 Channel に対して 自動セットアップ を 再実行 (Webhook 設定 + LIFF 作成 + 疎通テスト)。
 *
 * UI の 「自動セットアップ を 実行」ボタン から 呼ばれる。
 * 失敗 した 項目 が あった 場合 の リカバリ + 状況確認 にも 使える。
 */
export async function POST() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  const siteUrl = getSiteUrl();
  const webhookUrl = `${siteUrl}/api/webhooks/line/${channel.webhookToken}`;

  const result: {
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
  } = {
    botInfo: null,
    webhook: { ok: false, url: webhookUrl, registeredEndpoint: null, active: false },
    webhookTest: null,
    liffId: channel.liffId,
  };

  // 1) Bot 情報
  const bot = await getBotInfo(channel.channelAccessToken);
  if (bot.ok) {
    result.botInfo = { displayName: bot.data.displayName, basicId: bot.data.basicId };
  }

  // 2) Webhook URL を 設定
  const setResult = await setWebhookEndpoint(channel.channelAccessToken, webhookUrl);
  if (setResult.ok) {
    result.webhook.ok = true;
  } else {
    result.webhook.message = setResult.message;
  }

  const endpointInfo = await getWebhookEndpoint(channel.channelAccessToken);
  if (endpointInfo.ok) {
    result.webhook.registeredEndpoint = endpointInfo.data.endpoint;
    result.webhook.active = endpointInfo.data.active;
  }

  // 3) Webhook 疎通テスト (LINE → Myaira)
  const testResult = await testWebhookEndpoint(channel.channelAccessToken);
  if (testResult.ok) {
    result.webhookTest = {
      ok: testResult.data.success,
      statusCode: testResult.data.statusCode,
      reason: testResult.data.reason,
      detail: testResult.data.detail,
    };
  }

  // LIFF は LINE Login チャネル で 別途 作成 する 必要 が あり、 Messaging API 経由 で
  // 自動 作成 不可。 LIFF ID は 手動 で 設定 してもらう (LiffForm)。

  await admin
    .from("line_channels")
    .update({ last_verified_at: new Date().toISOString() })
    .eq("organization_id", guard.organization.id);

  return NextResponse.json({ ok: true, result });
}
