import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * PATCH /api/agency/organization/slack-webhook
 *
 * 組織の Slack Incoming Webhook URL を設定 / クリアする。
 * - admin 専用
 * - URL は https://hooks.slack.com/services/... を期待するが、厳密 URL バリデーションだけ
 *   かけて hosts は問わない(社内リレー等で書き換える運用がある)。
 * - null / 空文字を渡すとクリア。
 */

const requestSchema = z.object({
  slackWebhookUrl: z.string().url().max(500).or(z.null()).or(z.literal("")),
});

export async function PATCH(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const next =
    parsed.data.slackWebhookUrl === null || parsed.data.slackWebhookUrl === ""
      ? null
      : parsed.data.slackWebhookUrl;

  const { error } = await supabase
    .from("organizations")
    .update({ slack_webhook_url: next })
    .eq("id", role.organization.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
