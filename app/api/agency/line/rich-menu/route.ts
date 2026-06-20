import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { setDefaultRichMenu, unsetDefaultRichMenu } from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/rich-menu
 * 現在 の Rich Menu 設定 を 返す。
 *
 * POST /api/agency/line/rich-menu
 * デフォルト + 連携済 用 の Rich Menu ID を 設定。
 * null で クリア + LINE 側 で 解除。
 */
export async function GET() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const { data } = await guard.supabase
    .from("line_channels")
    .select("default_rich_menu_id, linked_rich_menu_id")
    .maybeSingle();
  const row = data as {
    default_rich_menu_id: string | null;
    linked_rich_menu_id: string | null;
  } | null;
  return NextResponse.json({
    defaultRichMenuId: row?.default_rich_menu_id ?? null,
    linkedRichMenuId: row?.linked_rich_menu_id ?? null,
  });
}

const bodySchema = z.object({
  defaultRichMenuId: z
    .string()
    .regex(/^richmenu-[a-f0-9]+$/, "Rich Menu ID 形式 (richmenu-xxx)")
    .nullable(),
  linkedRichMenuId: z
    .string()
    .regex(/^richmenu-[a-f0-9]+$/)
    .nullable(),
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
  const { defaultRichMenuId, linkedRichMenuId } = parsed.data;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  // LINE 側 で デフォルト Rich Menu を 設定 / 解除
  if (defaultRichMenuId) {
    const setResult = await setDefaultRichMenu(channel.channelAccessToken, defaultRichMenuId);
    if (!setResult.ok) {
      return NextResponse.json(
        { error: "line_api_failed", message: setResult.message },
        { status: 502 },
      );
    }
  } else {
    // null 指定 → デフォルト 解除
    const unsetResult = await unsetDefaultRichMenu(channel.channelAccessToken);
    if (!unsetResult.ok && unsetResult.status !== 404) {
      // 404 (= 未設定 を 解除 しようとした) は OK 扱い
      return NextResponse.json(
        { error: "line_api_failed", message: unsetResult.message },
        { status: 502 },
      );
    }
  }

  // DB 保存
  const { error } = await admin
    .from("line_channels")
    .update({
      default_rich_menu_id: defaultRichMenuId,
      linked_rich_menu_id: linkedRichMenuId,
    })
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
