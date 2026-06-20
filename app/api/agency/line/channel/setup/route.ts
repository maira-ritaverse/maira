import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getSiteUrl } from "@/lib/config/site-url";
import {
  createLiffApp,
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
  const liffEndpointUrl = `${siteUrl}/liff/${guard.organization.id}`;

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
    liff: {
      ok: boolean;
      liffId: string | null;
      created: boolean;
      message?: string;
    };
  } = {
    botInfo: null,
    webhook: { ok: false, url: webhookUrl, registeredEndpoint: null, active: false },
    webhookTest: null,
    liff: { ok: false, liffId: channel.liffId, created: false },
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

  // 現状 取得
  const endpointInfo = await getWebhookEndpoint(channel.channelAccessToken);
  if (endpointInfo.ok) {
    result.webhook.registeredEndpoint = endpointInfo.data.endpoint;
    result.webhook.active = endpointInfo.data.active;
  }

  // 3) Webhook 疎通テスト (LINE → Maira)
  const testResult = await testWebhookEndpoint(channel.channelAccessToken);
  if (testResult.ok) {
    result.webhookTest = {
      ok: testResult.data.success,
      statusCode: testResult.data.statusCode,
      reason: testResult.data.reason,
      detail: testResult.data.detail,
    };
  }

  // 4) LIFF アプリ (未作成 なら 自動作成)
  if (!channel.liffId) {
    const liffResult = await createLiffApp(channel.channelAccessToken, liffEndpointUrl);
    if (liffResult.ok) {
      result.liff.ok = true;
      result.liff.liffId = liffResult.data.liffId;
      result.liff.created = true;
      await admin
        .from("line_channels")
        .update({ liff_id: liffResult.data.liffId })
        .eq("organization_id", guard.organization.id);
    } else {
      result.liff.message = liffResult.message;
    }
  } else {
    result.liff.ok = true;
    result.liff.liffId = channel.liffId;
  }

  // last_verified_at 更新
  await admin
    .from("line_channels")
    .update({ last_verified_at: new Date().toISOString() })
    .eq("organization_id", guard.organization.id);

  return NextResponse.json({ ok: true, result });
}
