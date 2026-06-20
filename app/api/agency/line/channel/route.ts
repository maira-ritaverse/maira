import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { getSiteUrl } from "@/lib/config/site-url";
import { getBotInfo, setWebhookEndpoint } from "@/lib/line/api";
import { getMyLineChannel, upsertLineChannel } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/channel
 * 自組織の LINE Channel 設定 を 返す (Token は 返さず、 公開フィールド のみ)。
 * admin / advisor とも 閲覧可。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const channel = await getMyLineChannel(guard.supabase);
  if (!channel) {
    return NextResponse.json({ channel: null });
  }
  return NextResponse.json({ channel });
}

/**
 * POST /api/agency/line/channel
 * Channel 設定 を 登録 / 更新 (admin 限定)。
 * 登録時 に LINE API で 検証 → Bot 情報 を 保存 + last_verified_at 更新。
 */
const bodySchema = z.object({
  lineChannelId: z.string().min(1).max(100),
  channelSecret: z.string().min(20).max(100),
  channelAccessToken: z.string().min(100).max(500),
  linePlan: z.enum(["free", "light", "standard"]).nullable().optional(),
  monthlyMessageQuota: z.number().int().min(0).nullable().optional(),
});

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // 1) Access Token の 有効性 を 検証 (Bot 情報 取得)
  const botInfoResult = await getBotInfo(input.channelAccessToken);
  if (!botInfoResult.ok) {
    return NextResponse.json(
      {
        error: "verify_failed",
        message: `Access Token の 検証 に 失敗しました: ${botInfoResult.message}`,
        status: botInfoResult.status,
      },
      { status: 400 },
    );
  }
  const botInfo = botInfoResult.data;

  // 2) DB に upsert (service_role で 暗号化保存)
  const admin = createServiceClient();
  const channel = await upsertLineChannel(admin, {
    organizationId: guard.organization.id,
    lineChannelId: input.lineChannelId,
    channelSecret: input.channelSecret,
    channelAccessToken: input.channelAccessToken,
    lineBotUserId: botInfo.userId,
    linePlan: input.linePlan ?? null,
    monthlyMessageQuota: input.monthlyMessageQuota ?? null,
  });
  if (!channel) {
    return NextResponse.json(
      { error: "save_failed", message: "DB 保存 に 失敗 しました" },
      { status: 500 },
    );
  }

  // 3) 自動セットアップ:Webhook URL を LINE 側 に PUT。
  //    LIFF は LINE 仕様 (2019/11/11〜) で Messaging API チャネル の Token で 作成
  //    できない ため、 別途 LINE Login チャネル で 作って 貼り付けて もらう。
  //    失敗 しても DB 保存 は 巻き戻さない (後で 個別 ボタン で 再試行 可能)。
  const siteUrl = getSiteUrl();
  const webhookUrl = `${siteUrl}/api/webhooks/line/${channel.webhookToken}`;

  const autoSetup: {
    webhookSet: boolean;
    webhookError?: string;
  } = {
    webhookSet: false,
  };

  const webhookResult = await setWebhookEndpoint(input.channelAccessToken, webhookUrl);
  if (webhookResult.ok) {
    autoSetup.webhookSet = true;
  } else {
    autoSetup.webhookError = webhookResult.message;
  }

  return NextResponse.json({
    ok: true,
    channel,
    botInfo: {
      displayName: botInfo.displayName,
      basicId: botInfo.basicId,
      pictureUrl: botInfo.pictureUrl,
    },
    autoSetup,
    webhookUrl,
  });
}
