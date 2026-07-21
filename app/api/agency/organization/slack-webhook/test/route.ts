import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getOrganizationSlackWebhookUrl, sendSlackMessage } from "@/lib/slack/notify";

/**
 * POST /api/agency/organization/slack-webhook/test
 *
 * 現在保存されている Slack Webhook URL にテストメッセージを送る。admin 専用。
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const url = await getOrganizationSlackWebhookUrl(role.organization.id);
  if (!url) {
    return NextResponse.json(
      { error: "Webhook URL が未設定です(先に保存してください)" },
      { status: 400 },
    );
  }

  const result = await sendSlackMessage({
    webhookUrl: url,
    text: `:white_check_mark: ${role.organization.name} の Myaira 通知連携テストです。この投稿が見えていれば設定 OK です。`,
  });

  if (!result.sent) {
    return NextResponse.json(
      {
        error:
          result.reason === "failed"
            ? `送信失敗: ${result.error ?? "Unknown"}`
            : "URL が設定されていません",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true });
}
